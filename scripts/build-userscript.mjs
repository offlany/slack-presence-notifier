import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const core = await readFile(new URL("../src/presence-monitor.js", import.meta.url), "utf8");
const entry = await readFile(new URL("../src/userscript-entry.js", import.meta.url), "utf8");
const metadata = `// ==UserScript==
// @name         Slack Presence Notifier
// @namespace    local-slack-monitor
// @version      3.0.0
// @description  Monitor an authorized Slack account's rendered presence indicator
// @match        https://app.slack.com/client/*
// @run-at       document-idle
// @grant        GM_notification
// @noframes
// ==/UserScript==`;

await writeFile(
  new URL("../slack-presence-notifier.user.js", import.meta.url),
  `${metadata}\n\n${core.trim()}\n\n${entry.trim()}\n`,
  "utf8"
);

console.log(`Built ${projectRoot}/slack-presence-notifier.user.js`);
