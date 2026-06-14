"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_RUN_REGISTRY_POLICY = exports.RUN_REGISTRY_SCHEMA_VERSION = void 0;
exports.RUN_REGISTRY_SCHEMA_VERSION = 1;
exports.DEFAULT_RUN_REGISTRY_POLICY = {
    schemaVersion: 1,
    archiveOlderThanDays: 0,
    archiveStates: ["completed", "failed"],
    defaultQueuePriority: 100,
    reclaimAfterArchiveDays: 0,
    reclaimStates: ["completed", "failed"],
    keepSnapshots: false,
    keepScratch: false,
    maxReclaimRuns: 0,
    maxReclaimBytes: 0
};
