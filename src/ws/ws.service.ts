import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import { SubscribeMessage } from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'

type OtaMessage = {
  name: string
}

@WebSocketGateway(void 0, {
  cors: '*',
  transports: ['websocket']
})
export class WsService {
  @WebSocketServer()
  server: Server

  constructor() { }

  private getOtaRoom(name: string) {
    return `ota:${name}`
  }

  async sendBroadcast(type: string, data?: any, clientId?: string) {
    const sockets = await this.server.fetchSockets()
    for (const client of sockets) {
      if (!clientId || clientId === client.id) {
        client.emit('message', { type, data })
      }
    }
  }

  async sendOtaMessage(name: string, data: any) {
    this.server.to(this.getOtaRoom(name)).emit(name, data)
  }

  @SubscribeMessage('ota:subscribe')
  async handleOtaSubscribe(client: Socket, data: OtaMessage) {
    if (!data?.name) {
      return { event: 'ota:error', data: 'Ota is required' }
    }

    await client.join(this.getOtaRoom(data.name))
    return { event: 'ota:subscribed', data: { ota: data.name } }
  }

  @SubscribeMessage('ota:unsubscribe')
  async handleOtaUnsubscribe(client: Socket, data: OtaMessage) {
    if (!data?.name) {
      return { event: 'ota:error', data: 'Ota is required' }
    }

    await client.leave(this.getOtaRoom(data.name))
    return { event: 'ota:unsubscribed', data: { ota: data.name } }
  }

  @SubscribeMessage('message')
  handleMessage(client: Socket, data: string) {
    return { event: 'message', data: { type: data, data: client.id } }
  }
}
