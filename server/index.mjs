import * as cp from "node:child_process";
import * as fs from "node:fs";
import https from "node:https";
import os from "node:os";
import * as path from "node:path";
import * as url from "node:url";

import express from "express";
import anonymize from "ip-anonymize";
import nocache from "nocache";
import * as rpc from "vscode-ws-jsonrpc";
import * as jsonrpcserver from "vscode-ws-jsonrpc/server";
import { WebSocketServer } from "ws";

import { zLeanWebProjectConfig } from "./types.mjs";

let socketCounter = 0;

function logStats() {
  console.log(`[${new Date()}] Number of open sockets - ${socketCounter}`);
  console.log(
    `[${new Date()}] Free RAM - ${Math.round(os.freemem() / 1024 / 1024)} / ${Math.round(os.totalmem() / 1024 / 1024)} MB`,
  );
}

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

const environment = process.env.NODE_ENV;
const isGithubAction = process.env.GITHUB_ACTIONS;
const isDevelopment = environment === "development";
const NO_BWRAP = process.env.NO_BWRAP?.toLowerCase() === "true" ?? false;

const crtFile = process.env.SSL_CRT_FILE;
const keyFile = process.env.SSL_KEY_FILE;

const PROJECTS_BASE_PATH = path.join(
  __dirname,
  "..",
  process.env.PROJECTS_BASE_PATH ?? "Projects",
);

const app = express();

// our test setup waits until the server returns `200`
app.get("/health", (_req, res) => {
  res.status(200).send("Server is running");
});

// endpoint to list all available projects
app.use("/api/projects", async (req, res) => {
  try {
    const entries = await fs.promises.readdir(PROJECTS_BASE_PATH, {
      withFileTypes: true,
    });
    const projects = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const projectDir = path.join(PROJECTS_BASE_PATH, entry.name);
      const configPath = path.join(projectDir, "leanweb-config.json");
      const toolchainPath = path.join(projectDir, "lean-toolchain");

      let config = null;
      try {
        const raw = await fs.promises.readFile(configPath, "utf-8");
        const toolchain = (
          await fs.promises.readFile(toolchainPath, "utf-8")
        ).trim();

        config = zLeanWebProjectConfig.parse(JSON.parse(raw));
        config.name = config.name.replaceAll(
          "_LeanVers_",
          toolchainToName(toolchain, true),
        );
        config.name = config.name.replaceAll(
          "_Vers_",
          toolchainToName(toolchain, false),
        );
      } catch (err) {
        console.debug(err);
        // File missing or invalid JSON — keep config as null
      }

      if (config) {
        projects.push({
          folder: entry.name,
          config: {
            name: config.name,
            hidden: config.hidden ?? false,
            default: config.default ?? false,
            examples: config.examples ?? [],
            sortOrder: config.sortOrder ?? 0,
          },
        });
      }
    }

    res.json(projects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load projects" });
  }
});

// `*example` has the form `mathlib-demo/MathlibLatest/Logic.lean`
app.use("/api/example/:project/*example", (req, res, next) => {
  const pathComponents = req.params.example.filter((it) => it.length > 0);
  if (!(pathComponents[pathComponents.length - 1] ?? "").endsWith(".lean")) {
    res.status(400).json({ error: "Bad request" });
  } else {
    const filePath = path.join(req.params.project, ...pathComponents);
    req.url = filePath;
    express.static(PROJECTS_BASE_PATH)(req, res, next);
  }
});

// `:project` is the project like `mathlib-demo`
app.use("/api/manifest/:project", (req, res, next) => {
  const project = req.params.project;
  req.url = "lake-manifest.json";
  express.static(path.join(PROJECTS_BASE_PATH, project))(req, res, next);
});

// `:project` is the project like `mathlib-demo`
app.use("/api/toolchain/:project", (req, res, next) => {
  const project = req.params.project;
  req.url = "lean-toolchain";
  express.static(path.join(PROJECTS_BASE_PATH, project))(req, res, next);
});

// Using the client files
app.use(express.static(path.join(__dirname, "..", "client", "dist")));

app.use(nocache());

const hasBwrap = hasWorkingBwrap();
if (!hasBwrap) {
  if (isDevelopment) {
    if (!isGithubAction) {
      console.info("Bubblewrap is not available.");
    }
  } else {
    console.warn("Bubblewrap is not available!");
  }
}

let server;
if (crtFile && keyFile) {
  var privateKey = fs.readFileSync(keyFile, "utf8");
  var certificate = fs.readFileSync(crtFile, "utf8");
  var credentials = { key: privateKey, cert: certificate };

  const PORT = process.env.PORT ?? 443;
  server = https
    .createServer(credentials, app)
    .listen(PORT, () => console.log(`HTTPS on port ${PORT}`));

  // redirect http to https
  express().get("*", function (req, res) {
    res.redirect("https://" + req.headers.host + req.url).listen(80);
  });
} else {
  const PORT = process.env.PORT ?? 8080;
  server = app.listen(PORT, () => console.log(`HTTP on port ${PORT}`));
}

const wss = new WebSocketServer({ server });

function startServerProcess(project) {
  const PROJECT_PATH = path.join(PROJECTS_BASE_PATH, project);
  let serverProcess;
  if (isDevelopment) {
    serverProcess = cp.spawn("lake", ["serve", "--"], {
      cwd: PROJECT_PATH,
    });
  } else {
    if (hasWorkingBwrap()) {
      serverProcess = cp.spawn("./bubblewrap.sh", [PROJECT_PATH], {
        cwd: __dirname,
      });
    } else if (NO_BWRAP) {
      console.warn("Started process witouut bubblewrap!");
      serverProcess = cp.spawn("lake", ["serve", "--"], { cwd: PROJECT_PATH });
    } else {
      console.error(
        "Bubblewrap is not available! You can set `NO_BWRAP=true` to start the processes without container.",
      );
      return 300;
    }
  }

  // serverProcess.stdout.on('data', (data) => {
  //   console.log(`Lean Server: ${data}`);
  // });

  serverProcess.stderr.on("data", (data) =>
    console.error(`Lean Server: ${data}`),
  );

  serverProcess.on("error", (error) =>
    console.error(`Launching Lean Server failed: ${error}`),
  );

  serverProcess.on("close", (code) => {
    console.log(`lean server exited with code ${code}`);
  });

  return serverProcess;
}

/** Transform client URI to valid file on the server. (mutates the input `obj`) */
function urisToFilenames(prefix, obj) {
  for (let key in obj) {
    if (obj.hasOwnProperty(key)) {
      if (key === "uri") {
        obj[key] = obj[key].replace("file://", `file://${prefix}`);
      } else if (key === "rootUri") {
        obj[key] = obj[key].replace("file://", `file://${prefix}`);
      } else if (key === "rootPath") {
        obj[key] = path.join(prefix, obj[key]);
      }
      if (typeof obj[key] === "object" && obj[key] !== null) {
        urisToFilenames(prefix, obj[key]);
      }
    }
  }
  return obj;
}

/** Transform server file back into client URI. (mutates the input `obj`) */
function FilenamesToUri(prefix, obj) {
  for (let key in obj) {
    if (obj.hasOwnProperty(key)) {
      if (key === "uri") {
        obj[key] = obj[key].replace(prefix, "");
      }
      if (typeof obj[key] === "object" && obj[key] !== null) {
        FilenamesToUri(prefix, obj[key]);
      }
    }
  }
  return obj;
}

wss.addListener("connection", async function (ws, req) {
  const urlRegEx = /^\/websocket\/([\w.-]+)$/;
  const reRes = urlRegEx.exec(req.url);
  if (!reRes) {
    console.error(`Connection refused because of invalid URL: ${req.url}`);
    return;
  }
  const project = reRes[1];

  if (!project.match(/^[a-zA-Z][a-zA-Z1-9.-_]*/)) {
    console.error(
      `Connection refused because of invalid project name: ${project}`,
    );
    return;
  }

  const ip = anonymize(
    req.headers["x-forwarded-for"] || req.socket.remoteAddress,
  );
  const ps = await startServerProcess(project);

  if (ps === null) {
    console.error(
      `Connection refused because of nonexistent project directory: ${project}`,
    );
    return;
  }

  const reader = new rpc.WebSocketMessageReader({
    onMessage: (cb) => {
      ws.on("message", cb);
    },
    onError: (cb) => {
      ws.on("error", cb);
    },
    onClose: (cb) => {
      ws.on("close", cb);
    },
  });
  const writer = new rpc.WebSocketMessageWriter({
    send: (data, cb) => {
      ws.send(data, cb);
    },
  });
  const socketConnection = jsonrpcserver.createConnection(reader, writer, () =>
    ws.close(),
  );
  const serverConnection = jsonrpcserver.createProcessStreamConnection(ps);

  // --- `#echo` proof-of-concept state (per connection) ---
  // Non-fragile path: on the `$/lean/fileProgress`-done trigger we *pull* the
  // file's `#echo`s from the Lean server via the `Echo.collect` RPC method
  // (registered downstream by `import Echo`), then inject `$/echo/alert` to the
  // browser. No diagnostic string-matching.
  let currentVersion = NaN; // version the client is editing (from didOpen/didChange)
  let currentVersionComplete = false; // RPC already issued for currentVersion?
  let firedVersion = NaN; // version we've already alerted for (fire-once guard)
  let currentUri = null; // server-side document URI (as `lake serve` names it)

  // RPC plumbing: we send requests straight to `lake serve` (serverConnection),
  // tag them with string ids that can't collide with the client's numeric ids,
  // and resolve them from the server->client listener below.
  let rpcIdCounter = 0;
  const pendingRpc = new Map(); // id -> { resolve, reject }

  function sendServerRequest(method, params) {
    const id = `echo-${++rpcIdCounter}`;
    return new Promise((resolve, reject) => {
      pendingRpc.set(id, { resolve, reject });
      serverConnection.writer.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  // Pull `#echo`s for (uri, version) over RPC and alert the browser, once.
  // Connect-fresh-per-trigger: `Echo.collect` returns plain data (no
  // `WithRpcRef`), so the session is just a ticket for the call — we create one,
  // use it immediately, and let it self-expire (~30s), sidestepping keepAlive.
  async function collectAndAlert(uri, version) {
    if (firedVersion === version) return;
    try {
      const { sessionId } = await sendServerRequest("$/lean/rpc/connect", { uri });
      const result = await sendServerRequest("$/lean/rpc/call", {
        textDocument: { uri },
        position: { line: 0, character: 0 },
        sessionId,
        method: "Echo.collect",
        params: {},
      });
      const messages = result?.messages ?? [];
      const hasErrors = result?.hasErrors ?? false;
      console.log(
        `[echo] Echo.collect(v=${version}) -> ${JSON.stringify(messages)} hasErrors=${hasErrors}`,
      );
      if (messages.length > 0 && firedVersion !== version) {
        firedVersion = version;
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "$/echo/alert",
            params: { version, messages, hasErrors },
          }),
        );
      }
    } catch (e) {
      console.log(`[echo] Echo.collect failed: ${e?.message ?? e}`);
    }
  }

  // Debounce the post-`fileProgress`-done check to at most once per 4000ms.
  // Bursts of completions (rapid edits, the double empty-`processing`) coalesce
  // into a single trailing check that reads whatever the latest version is then.
  const ECHO_CHECK_INTERVAL_MS = 4000;
  let lastEchoCheckMs = 0;
  let echoCheckTimer = null;

  function scheduleEchoCheck() {
    if (echoCheckTimer !== null) return; // a check is pending; it'll see latest state
    const wait = Math.max(0, ECHO_CHECK_INTERVAL_MS - (Date.now() - lastEchoCheckMs));
    echoCheckTimer = setTimeout(() => {
      echoCheckTimer = null;
      lastEchoCheckMs = Date.now();
      collectAndAlert(currentUri, currentVersion);
    }, wait);
  }

  socketConnection.forward(serverConnection, (message) => {
    const prefix = isDevelopment ? PROJECTS_BASE_PATH : "";

    if (message.method != "textDocument/definition") {
      urisToFilenames(prefix, message);
    }

    if (
      message.method === "textDocument/didOpen" ||
      message.method === "textDocument/didChange"
    ) {
      currentVersion = message.params.textDocument.version;
      currentVersionComplete = false;
      console.log("CLIENT: Document version now " + currentVersion);
    }

    if (isDevelopment && !isGithubAction) {
      //console.log(`CLIENT: ${JSON.stringify(message)}`);
    }
    return message;
  });

  // We replace `serverConnection.forward(socketConnection, ...)` with a manual
  // `reader.listen` so we can *intercept* responses to our own injected RPC
  // requests and NOT forward them to the browser — `forward` always writes the
  // mapped message, so it cannot drop one.
  serverConnection.reader.listen((message) => {
    // (1) Intercept responses to our injected RPC requests (string ids).
    if (
      message.id !== undefined &&
      pendingRpc.has(message.id) &&
      (message.result !== undefined || message.error !== undefined)
    ) {
      const { resolve, reject } = pendingRpc.get(message.id);
      pendingRpc.delete(message.id);
      if (message.error !== undefined)
        reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
      return; // swallow: the browser never sent this, so never forward it
    }

    // (2) Capture the server-side URI from `fileProgress` BEFORE rewriting it,
    // so the RPC call addresses the document the way `lake serve` names it.
    if (message.method === "$/lean/fileProgress") {
      currentUri = message.params.textDocument.uri;
    }

    const prefix = isDevelopment ? PROJECTS_BASE_PATH : "";
    FilenamesToUri(prefix, message);

    if (message.method === "$/lean/fileProgress") {
      console.log(
        `[echo] fileProgress v=${message.params.textDocument.version} current=${currentVersion}` +
          ` processing=${message.params.processing.length} complete=${currentVersionComplete}`,
      );
    }

    // (3) Trigger: elaboration finished for the client's current version.
    if (
      message.method === "$/lean/fileProgress" &&
      message.params.processing.length === 0 &&
      message.params.textDocument.version === currentVersion &&
      !currentVersionComplete
    ) {
      currentVersionComplete = true;
      console.log("SERVER: Document load complete for " + currentVersion);
      // Debounced; the actual RPC pull runs fire-and-forget and resolves via the
      // interception branch above.
      scheduleEchoCheck();
    }

    if (isDevelopment && !isGithubAction) {
      //console.log(`SERVER: ${JSON.stringify(message)}`);
    }

    // (4) Forward everything else to the browser.
    socketConnection.writer.write(message);
  });

  ws.on("close", () => {
    socketCounter -= 1;
    if (echoCheckTimer !== null) clearTimeout(echoCheckTimer);
    if (!isGithubAction) {
      console.log(`[${new Date()}] Socket closed - ${ip}`);
      logStats();
    }
  });

  socketConnection.onClose(() => serverConnection.dispose());
  serverConnection.onClose(() => socketConnection.dispose());

  socketCounter += 1;
  if (!isGithubAction) {
    console.log(`[${new Date()}] Socket opened - ${ip}`);
    logStats();
  }
});

function hasWorkingBwrap() {
  const which = cp.spawnSync("which", ["bwrap"], { stdio: "ignore" });
  if (which.status !== 0) return false;
  const test = cp.spawnSync("bwrap", ["--version"], { stdio: "ignore" });
  return test.status === 0;
}

function toolchainToName(toolchain, prefixLean) {
  console.log(toolchain);
  const nightly = toolchain.match(/^leanprover\/lean4\:nightly-(.*)$/);
  if (nightly) return prefixLean ? `Lean ${nightly[1]}` : nightly[1];
  const release = toolchain.match(/^leanprover\/lean4\:(.*)$/);
  if (release) return prefixLean ? `Lean ${release[1]}` : release[1];
  return "Lean";
}
