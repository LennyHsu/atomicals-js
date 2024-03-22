import { sha256 as _sha256 } from '@noble/hashes/sha256';

interface BitworkInfo {
  input_bitwork: string;
  hex_bitwork: string;
  prefix: string;
  ext: number | undefined;
}

interface WorkerInput {
  seqStart: number;
  seqEnd: number;
  workerBitworkInfo: BitworkInfo;
  rawTxHex: string;
  sequencePosition: number;
  index: number;
}

const hasValidBitwork = (txid: Uint8Array, bitworkMap: { [key: number]: { [key: number]: boolean } },
  bitworLength: number
) => {
  for (let i = 0; i < bitworLength; i++) {
    const num = txid[txid.length - bitworLength + i]
    if (!bitworkMap[i][num]) {
      return false
    }
  }
  return true
}

function generateBitworkMap({ prefix, ext }: BitworkInfo) {
  const bitworkMap: { [key: number]: { [key: number]: boolean } } = {};

  const candidates: string[] = []
  if (ext) {
    for (let index = ext; index < 16; index++) {
      candidates.push(`${prefix}${index.toString(16)}`)
    }
  }
  else {
    candidates.push(prefix)
  }

  const items = candidates[0].length % 2 === 0 ? candidates : candidates.map(prefix => {
    return Array.from({ length: 16 }).map((_, index) => {
      return `${prefix}${index.toString(16)}`
    })
  })/*.flat()*/

  const bitworkLength = items[0].length / 2

  for (let item of items) {
    for (let index = 0; index < bitworkLength; index++) {
      const hex = parseInt(`${item[index * 2]}${item[index * 2 + 1]}`, 16)
      const position = bitworkLength - index - 1
      if (bitworkMap[position]) {
        bitworkMap[position][hex] = true
      }
      else {
        bitworkMap[position] = { [hex]: true }
      }
    }
  }

  return { bitworkMap, bitworkLength };
}

self.onmessage = async (event: MessageEvent<WorkerInput>) => {
  // Extract parameters from the message
  const {
    seqStart,
    seqEnd,
    workerBitworkInfo,
    rawTxHex,
    sequencePosition,
    index
  } = event.data;

  let sequence = seqStart;

  let finalSequence;
  let lastGenerated = 0;
  let lastTime = Date.now();

  const { bitworkMap, bitworkLength } = generateBitworkMap(workerBitworkInfo)
  const txUint8Array = new Uint8Array(Buffer.from(rawTxHex, 'hex'))

  do {
    if (sequence > seqEnd) {
      finalSequence = -1;
    }

    txUint8Array[sequencePosition] = sequence & 0xFF; // 最低位字节
    txUint8Array[sequencePosition + 1] = (sequence >> 8) & 0xFF;
    txUint8Array[sequencePosition + 2] = (sequence >> 16) & 0xFF;
    txUint8Array[sequencePosition + 3] = (sequence >> 24) & 0xFF; // 最高位字节

    const checkTxidBuffer = _sha256(_sha256(txUint8Array))

    if (
      workerBitworkInfo &&
      hasValidBitwork(
        checkTxidBuffer,
        bitworkMap,
        bitworkLength
      )
    ) {
      finalSequence = sequence;
      break;
    }

    sequence++;
    if ((sequence - seqStart) % 50000 === 0) {
      const now = Date.now()
      const hashRate = (((sequence - seqStart) - lastGenerated) / (now - lastTime)) * 1000;
      lastTime = now;
      lastGenerated = (sequence - seqStart);
      self.postMessage({
        kind: 'ops',
        data: { value: hashRate, index, generated: lastGenerated }
      })
    }
  } while (finalSequence === undefined);

  if (finalSequence && finalSequence !== -1) {
    self.postMessage({
      kind: 'complete',
      data: {
        sequence: finalSequence
      }
    });
  }
};