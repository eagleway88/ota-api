import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import { SubscribeMessage } from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'

type OtaMessage = {
  ota: string
}

type UidMessage = {
  uid: string
}

@WebSocketGateway(void 0, {
  cors: '*',
  transports: ['websocket']
})
export class WsService {
  @WebSocketServer()
  server: Server

  constructor() { }

  private getOtaRoom(ota: string) {
    return `ota:${ota}`
  }

  private getUidRoom(uid: string) {
    return `uid:${uid}`
  }

  async sendBroadcast(type: string, data?: any, clientId?: string) {
    const sockets = await this.server.fetchSockets()
    for (const client of sockets) {
      if (!clientId || clientId === client.id) {
        client.emit('message', { type, data })
      }
    }
  }

  async sendUidMessage(uid: string, data: any) {
    this.server.to(this.getUidRoom(uid)).emit(uid, data)
  }

  @SubscribeMessage('uid:subscribe')
  async handleUidSubscribe(client: Socket, data: UidMessage) {
    if (!data?.uid) {
      return { event: 'uid:error', data: 'Uid is required' }
    }

    await client.join(this.getUidRoom(data.uid))
    return { event: 'uid:subscribed', data: { uid: data.uid } }
  }

  @SubscribeMessage('uid:unsubscribe')
  async handleUidUnsubscribe(client: Socket, data: UidMessage) {
    if (!data?.uid) {
      return { event: 'uid:error', data: 'Uid is required' }
    }

    await client.leave(this.getUidRoom(data.uid))
    return { event: 'uid:unsubscribed', data: { uid: data.uid } }
  }

  async sendOtaMessage(ota: string, data: any) {
    this.server.to(this.getOtaRoom(ota)).emit(ota, data)
  }

  @SubscribeMessage('ota:subscribe')
  async handleOtaSubscribe(client: Socket, data: OtaMessage) {
    if (!data?.ota) {
      return { event: 'ota:error', data: 'Ota is required' }
    }

    await client.join(this.getOtaRoom(data.ota))
    return { event: 'ota:subscribed', data: { ota: data.ota } }
  }

  @SubscribeMessage('ota:unsubscribe')
  async handleOtaUnsubscribe(client: Socket, data: OtaMessage) {
    if (!data?.ota) {
      return { event: 'ota:error', data: 'Ota is required' }
    }

    await client.leave(this.getOtaRoom(data.ota))
    return { event: 'ota:unsubscribed', data: { ota: data.ota } }
  }

  @SubscribeMessage('message')
  handleMessage(client: Socket, data: string) {
    return { event: 'message', data: { type: data, data: client.id } }
  }
}
