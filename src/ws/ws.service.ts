import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import { SubscribeMessage } from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'

@WebSocketGateway(void 0, {
  cors: '*',
  transports: ['websocket']
})
export class WsService {
  @WebSocketServer()
  server: Server

  constructor() { }

  async sendBroadcast(type: string, data: any) {
    const sockets = await this.server.fetchSockets()
    for (const client of sockets) {
      client.emit(type, data)
    }
  }

  // test message
  @SubscribeMessage('message')
  handleMessage(client: Socket, data: string) {
    return { event: 'message', data: { type: data, data: client.id } }
  }
}
