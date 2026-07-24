// Run mutations retry bounded optimistic conflicts so a hot run cannot monopolize a worker.
export const MAX_CONCURRENT_RUN_UPDATE_ATTEMPTS = 16;
