// ═══════════════════════════════════════════════════════════════════════════════
// OPEN SOUND CONTROL (OSC) TYPE DEFINITIONS & DEFAULTS
// ═══════════════════════════════════════════════════════════════════════════════

export interface OscMessage {
  address: string;
  args: Array<number | string | boolean>;
  timestamp: number;
  sourceDeviceId?: string;
  sourceDeviceName?: string;
}

export type OscDeviceType =
  | 'network_udp'
  | 'websocket_bridge'
  | 'touchosc'
  | 'lemur'
  | 'max_msp'
  | 'puredata'
  | 'supercollider'
  | 'vrchat';

export interface OscDevice {
  id: string;
  name: string;
  type: OscDeviceType;
  host: string;
  port: number;
  status: 'connected' | 'listening' | 'disconnected' | 'simulated';
  enabled: boolean;
  isCustom?: boolean;
}

export type OscListener = (message: OscMessage) => void;
export type OscDeviceListener = (devices: OscDevice[]) => void;

export const DEFAULT_OSC_DEVICES: OscDevice[] = [
  {
    id: 'osc-dev-touchosc',
    name: 'TouchOSC Mobile Bridge',
    type: 'touchosc',
    host: '127.0.0.1',
    port: 8000,
    status: 'listening',
    enabled: true,
  },
  {
    id: 'osc-dev-maxmsp',
    name: 'Max/MSP / PureData Conduits',
    type: 'max_msp',
    host: '127.0.0.1',
    port: 9000,
    status: 'listening',
    enabled: true,
  },
  {
    id: 'osc-dev-ws',
    name: 'Local WebSocket OSC Relay',
    type: 'websocket_bridge',
    host: 'localhost',
    port: 8080,
    status: 'connected',
    enabled: true,
  },
  {
    id: 'osc-dev-vrchat',
    name: 'VRChat / Avatar OSC Port',
    type: 'vrchat',
    host: '127.0.0.1',
    port: 9001,
    status: 'listening',
    enabled: false,
  },
];
