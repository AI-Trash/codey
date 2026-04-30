declare module 'adbkit' {
  export interface AdbDevice {
    id: string
    type?: string
  }

  export interface AdbClient {
    listDevices(): Promise<AdbDevice[]>
    shell(serial: string, command: string): Promise<NodeJS.ReadableStream>
    push(
      serial: string,
      localPath: string,
      remotePath: string,
    ): Promise<NodeJS.ReadableStream>
    forward(serial: string, local: string, remote: string): Promise<void>
  }

  export interface AdbkitRuntime {
    createClient(): AdbClient
  }

  export function createClient(): AdbClient

  const runtime: AdbkitRuntime
  export default runtime
}
