// ══════════════════════════════════════════════════════════════════════════════════════════
// 1. SPECIALIZED WIRE CLASSES
// ══════════════════════════════════════════════════════════════════════════════════════════
import { GraphWireParent, QwnsrWireDescriptor } from './GraphWireParent';

export class QwnsrTriggerWire extends GraphWireParent {
  constructor(descriptor: Omit<QwnsrWireDescriptor, 'signalType'>) {
    super({ ...descriptor, signalType: 'trigger' });
    this.flowSpeedMultiplier = 1.2;
  }
}

export class QwnsrMidiWire extends GraphWireParent {
  constructor(descriptor: Omit<QwnsrWireDescriptor, 'signalType'>) {
    super({ ...descriptor, signalType: 'midi' });
    this.flowSpeedMultiplier = 1.0;
  }
}

export class QwnsrAudioWire extends GraphWireParent {
  constructor(descriptor: Omit<QwnsrWireDescriptor, 'signalType'>, isStereo: boolean = true) {
    super({ ...descriptor, signalType: isStereo ? 'audio_stereo' : 'audio_mono' });
    this.flowSpeedMultiplier = 1.5;
  }
}

export class QwnsrCurveWire extends GraphWireParent {
  constructor(descriptor: Omit<QwnsrWireDescriptor, 'signalType'>) {
    super({ ...descriptor, signalType: 'curve' });
    this.flowSpeedMultiplier = 0.8;
  }
}

export class QwnsrComponentWire extends GraphWireParent {
  constructor(descriptor: Omit<QwnsrWireDescriptor, 'signalType'>) {
    super({ ...descriptor, signalType: 'component' });
    this.flowSpeedMultiplier = 0.6;
  }
}

export class QwnsrEffectWire extends GraphWireParent {
  constructor(descriptor: Omit<QwnsrWireDescriptor, 'signalType'>) {
    super({ ...descriptor, signalType: 'effect' });
    this.flowSpeedMultiplier = 1.1;
  }
}

export function createQwnsrWireInstance(descriptor: QwnsrWireDescriptor): GraphWireParent {
  switch (descriptor.signalType) {
    case 'trigger':
      return new QwnsrTriggerWire(descriptor);
    case 'midi':
      return new QwnsrMidiWire(descriptor);
    case 'audio':
    case 'audio_mono':
      return new QwnsrAudioWire(descriptor, false);
    case 'audio_stereo':
      return new QwnsrAudioWire(descriptor, true);
    case 'curve':
      return new QwnsrCurveWire(descriptor);
    case 'component':
      return new QwnsrComponentWire(descriptor);
    case 'effect':
      return new QwnsrEffectWire(descriptor);
    default:
      return new QwnsrTriggerWire(descriptor);
  }
}
