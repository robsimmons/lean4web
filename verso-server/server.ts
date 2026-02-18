// Run this script to launch the server.
/* eslint no-console: "off" */

import { app } from './app.ts'

const PORT = parseInt(process.env.PORT || '8081')
app.listen(PORT, () => {
  console.log(`Verso compilation server is running on port ${PORT}`)
})
