/* eslint-disable no-use-before-define, block-scoped-var, no-var, vars-on-top, global-require */
if (typeof WebSocket !== 'function') {
  // WebSocket is not globally defined, probably running in node.js
  var WebSocket = require('ws');
}
if (typeof btoa !== 'function') {
  // btoa is not globally defined, probably running in node.js
  var btoa = require('btoa');
}
/* eslint-enable no-use-before-define, no-var, vars-on-top, global-require */


/**
 * WebSocket client to communicate with the netFIELD Proxy WebSocket.
 *
 * @class NetFieldProxyWebSocketClient
 */
class NetFieldProxyWebSocketClient {
  /**
   *Creates an instance of NetFieldProxyWebSocketClient.
   * @param {string} endpoint - WebSocket endpoint, e.g. wss://api.netfield.io/v1
   * @param {string} authorization - Access token or API key.
   * @param {string} deviceId - deviceId of the device running netFIELD Proxy.
   * @param {string} topic -
   *   topic to subscribe to (plaintext, converted to base64 automatically)
   * @param {Object} [handlers] - handlers for events and messages
   * @param {function} [handlers.pubMessageHandler=console.log] -
   *   Handler to be called on receiving a netFIELD Proxy update message on the WebSocket.
   * @param {function} [handlers.errorHandler=console.error] -
   *   Handler to be called on errors.
   * @param {function} [handlers.closeHandler=console.log] -
   *   Handler to be called on closing the connection.
   * @param {function} [handlers.unexpectedMessageHandler=console.warn] -
   *   Handler to be called on receiving an unexpected message.
   */
  constructor(
    endpoint,
    authorization,
    deviceId,
    topic,
    {
      pubMessageHandler = console.log,
      errorHandler = console.error,
      closeHandler = console.log,
      unexpectedMessageHandler = console.warn,
    },
  ) {
    this.endpoint = endpoint;
    // generate a clientId
    this.clientId = (Math.random() + 1).toString(36).substring(7);
    this.deviceId = deviceId;
    this.topic = topic;
    this.authorization = authorization;
    this.pubMessageHandler = pubMessageHandler;
    this.errorHandler = errorHandler;
    this.closeHandler = closeHandler;
    this.unexpectedMessageHandler = unexpectedMessageHandler;
    this.wsClient = this._initializeWebSocketClient();

    this.subscribeToTopic = this.subscribeToTopic.bind(this);
    this.send = this.send.bind(this);
    this.sendObject = this.sendObject.bind(this);
    this.close = this.close.bind(this);
  }

  /**
   * Initialize the WebSocket client.
   *
   * @access private
   *
   * @returns { WebSocket } WebSocket client.
   */
  _initializeWebSocketClient() {
    const client = new WebSocket(this.endpoint);
    client.onmessage = this._messageHandler.bind(this);
    client.onerror = this.errorHandler;
    client.onclose = this.closeHandler;
    client.onopen = this._sayHello.bind(this);
    return client;
  }

  /**
   * Handler to be invoked on receiving a message on the WebSocket.
   *
   * @param { WebSocket.MessageEvent } event - WebSocket message event.
   * @param { WebSocket.Data } event.data - WebSocket message data.
   *
   * @access private
   */
  _messageHandler({ data }) {
    try {
      const dataObj = JSON.parse(data);
      const { type, message, payload } = dataObj;
      if (payload && payload.error) {
        this.errorHandler(data);
        return;
      }
      switch (type) {
        case 'hello':
          // got a 'hello' response after successfully authenticating, subscribing
          this.subscribeToTopic(this.deviceId, this.topic);
          break;
        case 'sub':
          // got a 'sub' response after successfully subscribing
          // -> do nothing and wait for 'pub' messages
          break;
        case 'ping':
          // got a keep-alive 'ping' heartbeat from the server
          this._respondToHeartbeatPing();
          break;
        case 'pub':
          // got a 'pub' message from the server
          this.pubMessageHandler(message);
          break;
        default:
          this.unexpectedMessageHandler(data);
          break;
      }
    } catch (error) {
      this.errorHandler(error);
    }
  }

  /**
   * Subscribe to netFIELD proxy messages for the given device on the given topic.
   *
   * @param {string} deviceId - deviceId of the device running netFIELD Proxy.
   * @param {string} topic - topic to subscribe to (plaintext, converted to base64 automatically)
   */
  subscribeToTopic(deviceId, topic) {
    const topicAsBase64 = btoa(topic);
    const subscribePayload = {
      id: this.clientId,
      path: `/devices/${deviceId}/netfieldproxy/${topicAsBase64}`,
      type: 'sub',
    };
    this.sendObject(subscribePayload);
  }

  /**
   * Send a string message.
   *
   * @param {string} dataString - string to send.
   */
  send(dataString) {
    const { wsClient } = this;
    if (wsClient && wsClient.readyState === wsClient.OPEN) {
      wsClient.send(dataString);
    }
  }

  /**
   * Send a message by passing in an object which will be serialized before sending.
   *
   * @param {Object} dataObj - data object to send.
   */
  sendObject(dataObj) {
    this.send(JSON.stringify(dataObj));
  }

  /**
   * Close the connection to the WebSocket.
   *
   * @param {number} [code]
   * @param {string} [data]
   */
  close(code, data) {
    const { wsClient } = this;
    if (wsClient && wsClient.readyState === wsClient.OPEN) {
      wsClient.close(code, data);
    }
  }

  /**
   * Send a 'hello' message according the nes protocol which authenticates this client.
   *
   * https://github.com/hapijs/nes/blob/master/PROTOCOL.md#Hello
   *
   * @access private
   */
  _sayHello() {
    const helloPayload = {
      type: 'hello',
      auth: {
        headers: {
          authorization: this.authorization,
        },
      },
      id: this.clientId,
      version: '2',
    };
    this.sendObject(helloPayload);
  }

  /**
   * Send a heartbeat keep-alive ping response according to the nes protocol.
   *
   * https://github.com/hapijs/nes/blob/master/PROTOCOL.md#Heartbeat
   *
   * @access private
   */
  _respondToHeartbeatPing() {
    const pingResponsePayload = {
      id: this.clientId,
      type: 'ping',
    };
    this.sendObject(pingResponsePayload);
  }
}

// usage example

/**
 * Handler to be called on receiving a netFIELD Proxy update message on the WebSocket.
 *
 * @param {Object} netFieldProxyMessage - netFIELD Proxy update message object
 * @param {number} netFieldProxyMessage.createdAt - unix timestamp in milliseconds
 * @param {string} netFieldProxyMessage.topic - topic (plain text, not base64-encoded)
 * @param {string} netFieldProxyMessage.data - the message content
 */
const myPubMessageHandler = (netFieldProxyMessage) => {
  // do something with the received message
  console.log('Received a netFIELD proxy message:', netFieldProxyMessage);
};

/**
 * Handler called on errors.
 *
 * Error causes:
 * * WebSocket connection errors.
 * * Error parsing a received message.
 * * Invalid credentials.
 *
 * @param {*} error
 */
const myErrorHandler = (error) => {
  // do something on receiving an error
  console.error('An error occured:', error);
};

/**
 * Handler to be called on receiving an unexpected message.
 *
 * @param {string} message
 */
const myUnexpectedMessageHandler = (message) => {
  // do something on receiving an unexpected message
  console.warn('Received an unexpected message:', message);
};

/**
 * Handler to be called on closing the connection.
 *
 * @param {WebSocket.CloseEvent} event
 */
const myCloseHandler = (event) => {
  console.log('Connection to WebSocket closed:', event);
};

const handlers = {
  pubMessageHandler: myPubMessageHandler,
  errorHandler: myErrorHandler,
  unexpectedMessageHandler: myUnexpectedMessageHandler,
  closeHandler: myCloseHandler,
};

const endpoint = 'wss://api-training.netfield.io';
const deviceId = '5d8b5ae98796eb0c1ceca11f';
const topic = '/fromDeviceToCloud';
const authorization = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1SWQiOjEsIm9JZCI6MSwic0lkIjoiM2FhMzRhMGZlMzUxYzRlNDYyOGRlMmVjY2ExOGVjMDkiLCJpYXQiOjE1Njk1ODE1MTIsImV4cCI6MTYwMTExNzUxMn0.smuvb6MF9vBg7KCTD31lJ14-g4LJJmsLysOum63nLsI';

console.log(
  `Initializing connection to WebSocket at ${endpoint} and subscribing to topic ${topic} on device ${deviceId} ...`,
);

const client = new NetFieldProxyWebSocketClient(
  endpoint,
  authorization,
  deviceId,
  topic,
  handlers,
);

const keepConnectionOpenForSeconds = 60;
console.log(`Connection initialized, keeping open for ${keepConnectionOpenForSeconds} s ...`);
setTimeout(client.close, keepConnectionOpenForSeconds * 1000);
