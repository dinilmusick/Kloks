// ══════════════════════════════════════════════════════════════════════════════════════════
// 1. SPECIALIZED SOCKET CLASSES
// ══════════════════════════════════════════════════════════════════════════════════════════
import { GraphSocketParent, SocketDirection } from './GraphSocketParent';

export class QwnsrTriggerSocket extends GraphSocketParent {
  constructor(portId: string, label: string, direction: SocketDirection, index: number = 0, description?: string) {
    super({
      portId,
      label,
      signalType: 'trigger',
      socketIndex: index,
      direction,
      description: description || 'High-precision clock pulse or trigger event',
    });
  }
}

export class QwnsrMidiSocket extends GraphSocketParent {
  constructor(portId: string, label: string, direction: SocketDirection, index: number = 0, description?: string) {
    super({
      portId,
      label,
      signalType: 'midi',
      socketIndex: index,
      direction,
      description: description || 'Polyphonic note pitch, velocity, and CC message stream',
    });
  }
}

export class QwnsrAudioSocket extends GraphSocketParent {
  constructor(
    portId: string,
    label: string,
    direction: SocketDirection,
    index: number = 0,
    isStereo: boolean = true,
    description?: string
  ) {
    super({
      portId,
      label,
      signalType: isStereo ? 'audio_stereo' : 'audio_mono',
      socketIndex: index,
      direction,
      description: description || (isStereo ? 'Stereo multi-channel audio buffer' : 'Mono audio buffer stream'),
    });
  }
}

export class QwnsrCurveSocket extends GraphSocketParent {
  constructor(portId: string, label: string, direction: SocketDirection, index: number = 0, description?: string) {
    super({
      portId,
      label,
      signalType: 'curve',
      socketIndex: index,
      direction,
      description: description || 'Continuous modulation voltage / automation curve',
    });
  }
}

export class QwnsrComponentSocket extends GraphSocketParent {
  constructor(portId: string, label: string, direction: SocketDirection, index: number = 0, description?: string) {
    super({
      portId,
      label,
      signalType: 'component',
      socketIndex: index,
      direction,
      description: description || 'Direct structural asset link to audio buffer container or stem',
    });
  }
}

export class QwnsrEffectSocket extends GraphSocketParent {
  constructor(portId: string, label: string, direction: SocketDirection, index: number = 0, description?: string) {
    super({
      portId,
      label,
      signalType: 'effect',
      socketIndex: index,
      direction,
      description: description || 'Modifier field signal passing through effect AoE radius',
    });
  }
}
