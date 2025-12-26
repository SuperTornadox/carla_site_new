const path = require("path");

const projectRoot = __dirname;
const nodeBin = process.env.PM2_NODE_BIN || path.join(process.env.HOME || "", ".n", "bin", "node");
const port = process.env.CARLASITE_PORT || "3100";

module.exports = {
  apps: [
    {
      name: "carlasite-web",
      cwd: projectRoot,
      script: "node_modules/next/dist/bin/next",
      args: `start -p ${port}`,
      interpreter: nodeBin,
      env: {
        NODE_ENV: "production",
      },
      time: true,
      max_restarts: 10,
      restart_delay: 1000,
    },
  ],
};
