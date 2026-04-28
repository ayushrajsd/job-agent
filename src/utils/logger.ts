const VERBOSE = process.env.VERBOSE === 'true';

export function log(message: string): void {
  if (VERBOSE) {
    const ts = new Date().toISOString();
    console.log(`[${ts}] ${message}`);
  }
}

export function info(message: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] INFO  ${message}`);
}

export function warn(message: string): void {
  const ts = new Date().toISOString();
  console.warn(`[${ts}] WARN  ${message}`);
}

export function error(message: string): void {
  const ts = new Date().toISOString();
  console.error(`[${ts}] ERROR ${message}`);
}
