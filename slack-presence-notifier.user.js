// ==UserScript==
// @name         Slack Presence Notifier
// @namespace    local-slack-monitor
// @version      3.0.0
// @description  Monitor an authorized Slack account's rendered presence indicator
// @match        https://app.slack.com/client/*
// @run-at       document-idle
// @grant        GM_notification
// @noframes
// ==/UserScript==

(function (global, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    global.SlackPresenceMonitor = factory();
  }
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  "use strict";

  const runtime = typeof globalThis === "undefined" ? {} : globalThis;
  const DEFAULT_INDICATOR_SELECTOR =
    '[data-qa="presence_indicator"][data-qa-presence-self="false"]';
  const PLACEHOLDER_TARGET_NAME = "CHANGE_ME";
  const DEFAULT_INTERVAL_MS = 3000;
  const VALID_ATTRIBUTE_VALUES = new Set(["true", "false"]);

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function validateConfiguration({ targetName, intervalMs = DEFAULT_INTERVAL_MS, notify }) {
    const errors = [];

    if (!normalize(targetName) || normalize(targetName) === normalize(PLACEHOLDER_TARGET_NAME)) {
      errors.push("Set targetName to the exact visible name of the account you are authorized to monitor.");
    }

    if (!Number.isFinite(intervalMs) || intervalMs < 100) {
      errors.push("intervalMs must be a number of at least 100 milliseconds.");
    }

    if (typeof notify !== "function") {
      errors.push("A notification function is required.");
    }

    return errors;
  }

  function containsExactName(element, targetName) {
    const ownerDocument = element?.ownerDocument;
    if (!ownerDocument || typeof ownerDocument.createTreeWalker !== "function") {
      return false;
    }

    const nodeFilter = ownerDocument.defaultView?.NodeFilter ?? runtime.NodeFilter;
    const textNodeType = nodeFilter?.SHOW_TEXT ?? 4;
    const walker = ownerDocument.createTreeWalker(element, textNodeType);
    const expectedName = normalize(targetName);
    let node;

    while ((node = walker.nextNode())) {
      if (normalize(node.textContent) === expectedName) {
        return true;
      }
    }

    return false;
  }

  function findPresenceIndicators(documentRef, targetName, selector = DEFAULT_INDICATOR_SELECTOR) {
    if (!documentRef || typeof documentRef.querySelectorAll !== "function" || !normalize(targetName)) {
      return [];
    }

    const indicators = documentRef.querySelectorAll(selector);
    const matches = [];

    for (const indicator of indicators) {
      let parent = indicator.parentElement;

      for (let level = 0; level < 7 && parent; level += 1) {
        if (parent.querySelectorAll(selector).length > 1) {
          break;
        }

        if (containsExactName(parent, targetName)) {
          matches.push(indicator);
          break;
        }

        parent = parent.parentElement;
      }
    }

    return matches;
  }

  function readPresenceState(indicators) {
    const states = [
      ...new Set(
        indicators
          .map((indicator) => indicator.getAttribute("data-qa-presence-active"))
          .filter((value) => VALID_ATTRIBUTE_VALUES.has(value))
      )
    ];

    if (!indicators.length) {
      return { status: "missing", states };
    }

    if (states.length === 0) {
      return { status: "unknown", states };
    }

    if (states.length > 1) {
      return { status: "inconsistent", states };
    }

    return { status: states[0] === "true" ? "active" : "away", states };
  }

  function createPresenceMonitor({
    documentRef,
    targetName,
    intervalMs = DEFAULT_INTERVAL_MS,
    notify,
    onEvent,
    logger = runtime.console ?? { log() {}, warn() {}, error() {} },
    clock = runtime,
    indicatorSelector = DEFAULT_INDICATOR_SELECTOR,
    announceInitial = true
  }) {
    const configurationErrors = validateConfiguration({ targetName, intervalMs, notify });
    if (configurationErrors.length) {
      throw new Error(`Invalid monitor configuration: ${configurationErrors.join(" ")}`);
    }

    if (!documentRef || typeof documentRef.querySelectorAll !== "function") {
      throw new Error("A document-like object with querySelectorAll is required.");
    }

    let previousStatus = null;
    let missingWarning = false;
    let timer = null;

    function emit(event) {
      if (typeof onEvent !== "function") return;
      try {
        onEvent(event);
      } catch (error) {
        logger.error("[Slack Monitor] Event handler failed:", error);
      }
    }

    function sendNotification(message) {
      try {
        notify(message);
        emit({ type: "notification", message });
      } catch (error) {
        logger.error("[Slack Monitor] Notification failed:", error);
        emit({ type: "notification-error", error });
      }
    }

    function check() {
      const indicators = findPresenceIndicators(documentRef, targetName, indicatorSelector);

      if (!indicators.length) {
        if (!missingWarning) {
          logger.warn("[Slack Monitor] Target not found in the rendered sidebar.");
          emit({ type: "target-missing" });
          missingWarning = true;
        }
        return { status: "missing", states: [] };
      }

      missingWarning = false;
      const result = readPresenceState(indicators);

      if (result.status === "inconsistent") {
        logger.warn("[Slack Monitor] Matching indicators disagree; keeping the previous state.");
        emit({ type: "inconsistent-indicators", states: result.states });
        return result;
      }

      if (result.status === "unknown") {
        logger.warn("[Slack Monitor] Matching indicators have no valid state attribute.");
        emit({ type: "unknown-indicator-state", states: result.states });
        return result;
      }

      if (previousStatus === null) {
        logger.log("[Slack Monitor] Started:", result.status);
        emit({ type: "initial-state", status: result.status });
        if (announceInitial) {
          sendNotification(`Monitoring started. Current status: ${result.status}.`);
        }
        previousStatus = result.status;
        return result;
      }

      if (result.status !== previousStatus) {
        const message = `The configured user is now ${result.status.toUpperCase()}.`;
        logger.log("[Slack Monitor]", message);
        emit({ type: "status-changed", previousStatus, status: result.status });
        sendNotification(message);
        previousStatus = result.status;
      }

      return result;
    }

    function start() {
      if (timer !== null) return;
      check();
      timer = clock.setInterval(check, intervalMs);
    }

    function stop() {
      if (timer === null) return;
      clock.clearInterval(timer);
      timer = null;
    }

    return {
      check,
      start,
      stop,
      get previousStatus() {
        return previousStatus;
      }
    };
  }

  return Object.freeze({
    DEFAULT_INDICATOR_SELECTOR,
    DEFAULT_INTERVAL_MS,
    PLACEHOLDER_TARGET_NAME,
    containsExactName,
    createPresenceMonitor,
    findPresenceIndicators,
    readPresenceState,
    validateConfiguration
  });
});

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
