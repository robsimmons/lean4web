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
  // `currentVersion`: the document version the client is currently editing.
  // `echoes`: the `#echo` messages collected from diagnostics for that version.
  // `currentVersionComplete`: whether elaboration finished for that version.
  // `firedVersion`: the version we've already alerted for (fire-once guard).
  let currentVersion = NaN;
  let currentVersionComplete = false;
  let echoes = [];
  let firedVersion = NaN;

  // Fire once per version, when elaboration is done AND we've collected at least
  // one `#echo`. The two signals race: on load the diagnostic lands before the
  // empty `fileProgress`, but on edits the empty `fileProgress` lands first and
  // the diagnostic follows — so we call this from both sites and let whichever
  // completes the pair do the injection.
  function maybeFireEcho() {
    if (
      currentVersionComplete &&
      echoes.length > 0 &&
      firedVersion !== currentVersion
    ) {
      firedVersion = currentVersion;
      console.log(
        `[echo] firing $/echo/alert for v=${currentVersion}: ${JSON.stringify(echoes)}`,
      );
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "$/echo/alert",
          params: { version: currentVersion, messages: echoes },
        }),
      );
    }
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
      echoes = [];
      console.log(
        "CLIENT: Document version now " +
          message.params.textDocument.version,
      );
    }

    if (isDevelopment && !isGithubAction) {
      //console.log(`CLIENT: ${JSON.stringify(message)}`);
    }
    return message;
  });
  serverConnection.forward(socketConnection, (message) => {
    const prefix = isDevelopment ? PROJECTS_BASE_PATH : "";
    FilenamesToUri(prefix, message);

    // Collect `#echo` messages as they are published as information diagnostics.
    // `Echo.lean` logs each `#echo "..."` as `#echo: ...`. Lean may publish
    // diagnostics incrementally (`isIncremental: true` => append to the previous
    // set) or as a full set (replace), so we mirror that here.
    if (message.method === "textDocument/publishDiagnostics") {
      const allMsgs = (message.params.diagnostics ?? []).map((d) => d.message);
      console.log(
        `[echo] publishDiagnostics v=${message.params.version} current=${currentVersion}` +
          ` incremental=${message.params.isIncremental} n=${allMsgs.length}` +
          ` msgs=${JSON.stringify(allMsgs)}`,
      );
      if (message.params.version === currentVersion) {
        const MARKER = "#echo: ";
        const found = allMsgs
          .filter((m) => typeof m === "string" && m.startsWith(MARKER))
          .map((m) => m.slice(MARKER.length));
        echoes = message.params.isIncremental === true ? echoes.concat(found) : found;
        console.log(`[echo] echoes now = ${JSON.stringify(echoes)}`);
        maybeFireEcho(); // diagnostic may arrive after fileProgress-done (edits)
      } else {
        console.log(
          `[echo] (version mismatch -> not collecting; ` +
            `diag v=${message.params.version} != current=${currentVersion})`,
        );
      }
    }

    if (message.method === "$/lean/fileProgress") {
      console.log(
        `[echo] fileProgress v=${message.params.textDocument.version} current=${currentVersion}` +
          ` processing=${message.params.processing.length}` +
          ` complete=${currentVersionComplete} echoes=${echoes.length}`,
      );
    }

    if (
      message.method === "$/lean/fileProgress" &&
      message.params.processing.length === 0 &&
      message.params.textDocument.version === currentVersion &&
      !currentVersionComplete
    ) {
      currentVersionComplete = true;
      console.log("SERVER: Document load complete for " + currentVersion);

      // PoC: ask the browser to alert() if this file contained any `#echo`s.
      // The injection itself happens in `maybeFireEcho` (the `#echo` diagnostic
      // may not have arrived yet on edits), via a passive tap in the client
      // (client/src/echo-alert.ts) that surfaces it as an alert.
      maybeFireEcho();
    }

    if (isDevelopment && !isGithubAction) {
      //console.log(`SERVER: ${JSON.stringify(message)}`);
    }
    return message;
  });

  ws.on("close", () => {
    socketCounter -= 1;
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
