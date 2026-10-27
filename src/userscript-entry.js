(function () {
  "use strict";

  const monitorApi = globalThis.SlackPresenceMonitor;
  const configuration = Object.freeze({
    targetName: "CHANGE_ME",
    intervalMs: 3000
  });

  const configurationErrors = monitorApi.validateConfiguration({
    targetName: configuration.targetName,
    intervalMs: configuration.intervalMs,
    notify: globalThis.GM_notification
  });

  if (configurationErrors.length) {
    console.error("[Slack Monitor] Configuration error:", configurationErrors.join(" "));
    return;
  }

  const monitor = monitorApi.createPresenceMonitor({
    documentRef: document,
    targetName: configuration.targetName,
    intervalMs: configuration.intervalMs,
    notify(message) {
      globalThis.GM_notification({
        title: "Slack Presence Monitor",
        text: message,
        timeout: 10000
      });
    },
    logger: console
  });

  monitor.start();
})();
