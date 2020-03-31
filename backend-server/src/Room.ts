import { Room, Client } from "colyseus";
import { Schema, MapSchema, type } from "@colyseus/schema";
import { random } from "lodash";

export class Player extends Schema {
    @type("int32")
    x = 0;
    @type("int32")
    y = 0;
    @type("string")
    name = null;
}

export class State extends Schema {
    @type({ map: Player })
    players = new MapSchema<Player>();
    @type("int32")
    width = 100;
    @type("int32")
    height = 100;
}

type Move = {
    type: "Move"
    x: number,
    y: number
}

type Message = Move;

export default class ChatRoom extends Room<State> {
    onCreate(options: { displayName: string }) {
        this.setState(new State({ width: 100, height: 100 }));
        this.setMetadata({ displayName: options.displayName })
    }
    onJoin(client: Client, options: { userName: string } & ({ x: number, y: number } | { x: undefined, y: undefined })) {
        const [x, y] = options.x == null || options.y == null
            ? [random(0, this.state.width), random(0, this.state.width)]
            : [options.x, options.y];
        this.state.players[client.sessionId] = new Player;
        this.state.players[client.sessionId].name = options.userName;
        this.state.players[client.sessionId].x = x;
        this.state.players[client.sessionId].y = y;
    }
    onLeave(client: Client) {
        this.state.players[client.sessionId] = undefined;
    }
    onMessage(client: Client, message: Message) {
        const player = this.state.players[client.sessionId];
        if (!player) {
            return;
        }
        if (message.type === "Move") {
            player.x = message.x;
            player.y = message.y;
        }
    }
}