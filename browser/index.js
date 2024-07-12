import{EventEmitter as e}from"https://unpkg.com/eventemitter3@5/dist/eventemitter3.esm.min.js";class t extends e{constructor(e){super(),this.connected=!1,this.connecting=!1,this.reconnecting=!1,this.closed=!1,this.connectTime=Date.now(),this.minTimeBetweenReconnectsMS=0,this.url=e.url,e.WebSocket?this.WebSocket=e.WebSocket:this.WebSocket=WebSocket,e.minTimeBetweenReconnectsMS&&(this.minTimeBetweenReconnectsMS=e.minTimeBetweenReconnectsMS),e.autoconnect&&this.connect()}send(e){var t;if(!this.connected)throw new Error("WebSocket not ready");return null===(t=this.websocket)||void 0===t||t.send(e),this}ready(){return this.connected?Promise.resolve():this.waitOnce("open")}waitOnce(e){return new Promise((t=>{this.once(e,((...e)=>{switch(e.length){case 0:t(void 0);break;case 1:t(e[0]);break;default:t(e)}}))}))}close(e,t){this.connected=!1,this.connecting=!1,this.closed=!0,this.websocket?this.websocket.close(e,t):this.emit("close")}async connect(){if(this.connected)return this;if(this.connecting)return this;this.connecting=!0;try{this.connectTime=Date.now();const e=new this.WebSocket(await this.url()),t=()=>{e.removeEventListener("open",t),this.connected=!0,this.emit("open")};e.addEventListener("open",t),e.addEventListener("close",(()=>{this.websocket=void 0,this.connected=!1,this.closed?this.emit("close"):(this.emit("disconnect"),this.reconnect())})),e.addEventListener("message",(e=>{this.emit("message",e.data)})),e.addEventListener("error",(()=>{this.emit("error")})),this.websocket=e}catch(e){this.emit("error",e),this.reconnect()}finally{this.connecting=!1}return this}reconnect(){if(this.reconnecting)return this;this.reconnecting=!0;try{const e=Date.now()-this.connectTime;e<this.minTimeBetweenReconnectsMS?setTimeout((()=>{this.connect()}),this.minTimeBetweenReconnectsMS-e):this.connect()}finally{this.reconnecting=!1}return this}}export{t as KeepAliveWebSocket};
//# sourceMappingURL=index.js.map
