const PING_CHAR = 57;
const PONG = new Uint8Array([65]);

const MESSAGE_SEPARATOR = "$/$";

type BaseRoomMember = {
    pos: {
        x: number,
        y: number,
    }
};

export type RoomUser = BaseRoomMember & {
    type: "USER",
    name: string,
};

export type RoomSink = BaseRoomMember & {
    type: "SINK",
    owner: string,
}

export type RoomMember = RoomSink | RoomUser;

function isPing(data: any) {
    if (!(data instanceof ArrayBuffer)) {
        return false;
    }
    const buffer = new Uint8Array(data);
    return buffer.length === 1 && buffer[0] === PING_CHAR;
}

export default class Socket {
    private _id: string = "PLACEHOLDER";
    private readonly _listeners: { [fn: string]: ((data: string) => void)[] } = {};
    private readonly _peerConnections: { [id: string]: RTCPeerConnection } = {};
    private _globalPeerConnectionListener: ((id: string, connection: RTCPeerConnection | null) => void) | null = null;
    private readonly _peerConnectionListeners: { [id: string]: ((cxn: RTCPeerConnection | null) => void)[] } = {}

    get id(): string {
        return this._id;
    }

    static async init(): Promise<Socket> {
        const socket = new WebSocket(process.env.BACKEND_SERVER_URL!);
        const instance = new Socket(socket);
        await new Promise((resolve, reject) => {
            socket.onopen = resolve;
            socket.onerror = reject;
            socket.binaryType = 'arraybuffer';
            socket.onmessage = instance.handleMessage.bind(instance);
        });
        instance._id = await instance.getStringResponse("ME");
        instance.onAddMember(async member => {
            instance.initializePeerConnection(member.id);
            instance._peerConnections[member.id].onicecandidate = async ({ candidate }) => {
                await instance.getStringResponse("CONNECTION.CANDIDATE", member.id, JSON.stringify(candidate));
            }
            instance.onPeerConnection(member.id, instance._peerConnections[member.id]);
        });
        instance.onRemoveMembers(members => {
            members.forEach(id => {
                if (instance._peerConnections[id]) {
                    instance._peerConnections[id].close();
                    delete instance._peerConnections[id];
                }
            })
        });
        instance.addListener("CONNECTION.CANDIDATE", data => {
            const [id, ...rest] = data.split(MESSAGE_SEPARATOR);
            return instance.addPeerConnectionIceCandidate(id, JSON.parse(rest.join(MESSAGE_SEPARATOR)));
        });
        instance.addListener("CONNECTION.OFFER", data => {
            const [id, ...rest] = data.split(MESSAGE_SEPARATOR);
            return instance.acceptPeerConnectionOffer(id, JSON.parse(rest.join(MESSAGE_SEPARATOR)));
        });
        instance.addListener("CONNECTION.ANSWER", data => {
            const [id, ...rest] = data.split(MESSAGE_SEPARATOR);
            return instance.acceptPeerConnectionAnswer(id, JSON.parse(rest.join(MESSAGE_SEPARATOR)));
        })
        console.info("Socket connected");
        return instance;
    }

    constructor(private readonly socket: WebSocket) { }

    protected addListener(key: string, callback: (data: string) => void) {
        this._listeners[key] = this._listeners[key] || [];
        this._listeners[key].push(callback);
    }


    protected removeListener(key: string, callback: (data: string) => void) {
        this._listeners[key] = this._listeners[key] || [];
        const index = this._listeners[key].indexOf(callback);
        if (index >= 0) {
            this._listeners[key].splice(index, 1);
        }
    }

    protected attachCallback(key: string, cb: (data: string) => void): () => void {
        this.addListener(key, cb);
        return () => this.removeListener(key, cb);
    }

    private async handleMessage(message: MessageEvent): Promise<void> {
        if (isPing(message.data)) {
            console.info("PING");
            this.socket.send(PONG);
            return;
        } else if (typeof message.data === 'string') {
            const { action, data } = parseStringMessage(message.data);
            if (this._listeners[action]) {
                this._listeners[action].forEach(cb => cb(data));
            } else {
                console.warn("No Listeners for", action);
            }
        }
    }

    private onPeerConnection(id: string, peerConnection: RTCPeerConnection | null) {
        if (this._globalPeerConnectionListener) {
            this._globalPeerConnectionListener(id, peerConnection);
        }
        if (this._peerConnectionListeners[id]) {
            this._peerConnectionListeners[id].forEach(listener => listener(peerConnection));
        }
    }

    private initializePeerConnection(otherID: string) {
        if (this._peerConnections[otherID]) {
            return;
        }
        const connection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun01.sipphone.com' },
                { urls: 'stun:stun.ekiga.net' },
                { urls: 'stun:stun.fwdnet.net' },
                { urls: 'stun:stun.ideasip.com' },
                { urls: 'stun:stun.iptel.org' },
                { urls: 'stun:stun.rixtelecom.se' },
                { urls: 'stun:stun.schlund.de' },
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                { urls: 'stun:stunserver.org' },
                { urls: 'stun:stun.softjoys.com' },
                { urls: 'stun:stun.voiparound.com' },
                { urls: 'stun:stun.voipbuster.com' },
                { urls: 'stun:stun.voipstunt.com' },
                { urls: 'stun:stun.voxgratia.org' },
                { urls: 'stun:stun.xten.com' },
            ]
        });
        connection.onnegotiationneeded = async () => {
            const offer = await connection.createOffer({ voiceActivityDetection: true });
            await connection.setLocalDescription(offer);
            await this.getStringResponse("CONNECTION.OFFER", otherID, JSON.stringify(connection.localDescription));
        }
        this._peerConnections[otherID] = connection;
    }

    private async getStringResponse(key: string, ...data: string[]): Promise<string> {
        sendStringMessage(this.socket, key, ...data);
        return await new Promise((res, rej) => {
            function successListener(data: string) {
                res(data);
                removeListeners();
            }
            function failureListener(data: string) {
                rej(data);
                removeListeners();
            }
            const self = this;
            function removeListeners() {
                self.removeListener(`${key}.SUCCESS`, successListener);
                self.removeListener(`${key}.FAILURE`, failureListener);
            }
            this.addListener(`${key}.SUCCESS`, successListener);
            this.addListener(`${key}.FAILURE`, failureListener);

        });
    }

    private async acceptPeerConnectionOffer(id: string, offer: RTCSessionDescription) {
        await this.initializePeerConnection(id);
        await this._peerConnections[id].setRemoteDescription(offer);
        this.onPeerConnection(id, this._peerConnections[id]);
        const answer = await this._peerConnections[id].createAnswer({ voiceActivityDetection: true });
        this._peerConnections[id].setLocalDescription(answer);
        await this.getStringResponse("CONNECTION.ANSWER", id, JSON.stringify(answer));
    }

    private async acceptPeerConnectionAnswer(id: string, answer: RTCSessionDescription) {
        if (!this._peerConnections[id]) {
            return;
        }
        await this._peerConnections[id].setRemoteDescription(answer);
    }

    private async addPeerConnectionIceCandidate(id: string, candidate: RTCIceCandidate | null) {
        if (!this._peerConnections[id]) {
            return;
        }
        if (candidate) {
            await this._peerConnections[id].addIceCandidate(candidate);
        }
    }

    async setUserName(name: string): Promise<void> {
        await this.getStringResponse("NAME.SET", name);
    }

    async listRooms(): Promise<{ [id: string]: string }> {
        const data = await this.getStringResponse("ROOM.LIST");
        return JSON.parse(data);
    }

    async listRoomMembers(): Promise<{ [id: string]: RoomMember }> {
        const data = await this.getStringResponse("ROOM.LISTMEMBERS");
        return JSON.parse(data);
    }

    async updatePosition(data: { id: string, pos: { x: number, y: number } }): Promise<void> {
        await this.getStringResponse(
            "ROOM.MOVE",
            data.id,
            String(data.pos.x),
            String(data.pos.y)
        );
    }

    async joinRoom(roomID: string): Promise<void> {
        await this.getStringResponse("ROOM.JOIN", roomID);
    }

    async leaveRoom(): Promise<void> {
        await this.getStringResponse("ROOM.LEAVE");
        Object.entries(this._peerConnections).forEach(([id, connection]) => {
            connection.close();
            delete this._peerConnections[id];
            this.onPeerConnection(id, null);
        });
    }

    async createRoom(name: string): Promise<string> {
        return await this.getStringResponse("ROOM.NEW", name);
    }

    async createSink(): Promise<void> {
        await this.getStringResponse("ROOM.SINK.NEW");
    }

    async startSink(sink: string): Promise<void> {
        await this.getStringResponse("ROOM.SINK.START", sink);
    }
    async stopSink(sink: string): Promise<void> {
        await this.getStringResponse("ROOM.SINK.STOP", sink);
    }

    async playSink(sink: string): Promise<void> {
        await this.getStringResponse("ROOM.SINK.PLAY", sink);
    }

    addPeerConnectionListener(id: string, callback: (data: RTCPeerConnection | null) => void) {
        if (id === this.id) {
            return;
        }
        this._peerConnectionListeners[id] = this._peerConnectionListeners[id] || [];
        this._peerConnectionListeners[id].push(callback);
        if (this._peerConnections[id]) {
            callback(this._peerConnections[id]);
        }
        return () => {
            this._peerConnectionListeners[id].splice(this._peerConnectionListeners[id].indexOf(callback), 1);
        }
    }

    addGlobalPeerConnectionListener(callback: (id: string, connection: RTCPeerConnection | null) => void) {
        this._globalPeerConnectionListener = callback;
        Object.entries(this._peerConnections).forEach(([id, connection]) => callback(id, connection));
        return () => { this._globalPeerConnectionListener = null };
    }

    onAddMember(callback: (member: RoomMember & { id: string }) => void) {
        return this.attachCallback("ROOM.NEWMEMBER", (data: string) => {
            callback(JSON.parse(data));
        });
    }

    onRemoveMembers(callback: (ids: string[]) => void) {
        return this.attachCallback("ROOM.LEAVE.MEMBERS", (data: string) => {
            const members = data.split(MESSAGE_SEPARATOR);
            return callback(members);
        });
    }

    onMoveMember(callback: (data: { id: string, pos: { x: number, y: number } }) => void) {
        return this.attachCallback("ROOM.MEMBER.MOVE", data => {
            const [id, x, y] = data.split(MESSAGE_SEPARATOR);
            return callback({
                id,
                pos: {
                    x: parseInt(x),
                    y: parseInt(y),
                }
            });
        });
    }

    async close() {
        try {
            await this.leaveRoom();
        } catch (e) {

        }
        this.socket.close();
    }
}

function sendStringMessage(socket: WebSocket, action: string, ...parts: string[]) {
    socket.send([action, ...parts].join(MESSAGE_SEPARATOR))
}

function parseStringMessage(message: string) {
    const [
        action,
        ...data
    ] = message.split(MESSAGE_SEPARATOR);
    return {
        action,
        data: data.join(MESSAGE_SEPARATOR),
    }
}

function isPeerConnectionReady(peerConnection?: RTCPeerConnection) {
    return peerConnection?.connectionState === "connected";
}