import * as net from 'net';

export class PromiseSocket {
  constructor(public socket: net.Socket) {}

  public connect(port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.connect(port, host, () => {
        resolve();
      });
      this.socket.on('error', err => {
        reject(err);
      });
    });
  }

  async write(data: string) {
    return new Promise<void>((resolve, reject) => {
      this.socket.write(data, () => {
        resolve();
      });
      this.socket.on('error', err => {
        reject(err);
      });
    });
  }
}