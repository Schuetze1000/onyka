export function findAvailablePort(preferredPort?: number | string, host?: string): Promise<number>
export function resolvePackageCli(packageName: string, cwd: string): string
export function frontendUrlFromOutput(output: string): string | null
