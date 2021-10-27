
#pragma once

#include "Arduino.h"
#include <cstdint>

const int kPointsPerMediumSizePacket = 10;
const int kADCChannels = 2;
const int kPointsPerPacket = 1;
extern int gADCPointsPerPacket;

class PacketBase
{
protected:
  static uint8_t sPacketCount;
};

class Packet : protected PacketBase
{
  //The header is 5 nibbles, i.e. "P\xA0\x40". The low nibble of the
  //3rd byte is the packet time (0x04) for data packets.
  //The head and packet type is followed by a 1 byte packet count number,
  //making a total of 4 bytes before the payload daya that need to match the
  //expected pattern(s) before the client can detect a packet.
  const char sHeader[2] = {'P', 0xA0};

public:
  static void ResetPacketCount()
  {
    sPacketCount = 0;
  }

  Packet() : mPoint(0)
  {
  }

  bool addSample(int chan, int16_t sample)
  {
    if (mPoint >= gADCPointsPerPacket)
      return false;

    mData[mPoint][chan] = sample;
    return true;
  }

  void nextPoint()
  {
    ++mPoint;
  }

  //returns number of bytes written
  int write(Stream &stream) const
  {
    int n = stream.write(sHeader, 2);
    //Write the packet type byte (D for data, M for medium sized data packet)
    n += stream.write(uint8_t(gADCPointsPerPacket == 1 ? 'D' : 'M'));
    n += stream.write(sPacketCount++);
    n += stream.write(reinterpret_cast<const uint8_t *>(mData), sizeof(int16_t) * kADCChannels * gADCPointsPerPacket);
    return n;
  }

protected:
  int mPoint;
  int16_t mData[kPointsPerMediumSizePacket][kADCChannels];
};


class TimePacket : protected PacketBase
{
  const char sHeaderAndPacketType[3] = {'P', 0xA0, 'N'}; //'N' for now

public:
  TimePacket(int32_t tick32us, uint8_t timeRequestNumber) : mTimeRequestNumber(timeRequestNumber)
  {
    mData[0] = tick32us;
  }

  int writeData(Stream &stream) const
  {
    int n = stream.write(sPacketCount++);
    n += stream.write(mTimeRequestNumber);
    n += stream.write(reinterpret_cast<const uint8_t *>(mData), sizeof(mData));
    return n;
  }

  //returns number of bytes written
  int write(Stream &stream) const
  {
    int n = stream.write(sHeaderAndPacketType, 3);
    n += writeData(stream);
    return n;
  }

protected:
  int32_t mData[1];
  uint8_t mTimeRequestNumber;
};

class FirstSampleTimePacket : protected PacketBase
{
  const char sHeaderAndPacketType[3] = {'P', 0xA0, 'F'}; //'F' for First sample time

public:
  FirstSampleTimePacket(int32_t tick32us)
  {
    mData[0] = tick32us;
  }

  //returns number of bytes written
  int write(Stream &stream) const
  {
    int n = stream.write(sHeaderAndPacketType, 3);
    n += stream.write(sPacketCount++);
    n += stream.write(reinterpret_cast<const uint8_t *>(mData), sizeof(mData));
    return n;
  }

protected:
  int32_t mData[1];
};


class LatestUSBFrameTimePacket : protected TimePacket
{
  const char sHeaderAndPacketType[3] = {'P', 0xA0, 'L'}; //'L' for latest USB Start Of Frame time

public:
  LatestUSBFrameTimePacket(int32_t tick32us, uint8_t timeRequestNumber, uint16_t frameNumber, int32_t latestFrameus) : TimePacket(tick32us, timeRequestNumber)
  {
    mFrameNumber = frameNumber;
    mFrameTimeus = latestFrameus;
  }

  //returns number of bytes written
  int write(Stream &stream) const
  {
    int n = stream.write(sHeaderAndPacketType, 3);
    n += TimePacket::writeData(stream);
    n += stream.write(reinterpret_cast<const uint8_t *>(&mFrameNumber), sizeof(mFrameNumber));
    n += stream.write(reinterpret_cast<const uint8_t *>(&mFrameTimeus), sizeof(mFrameTimeus));
    return n;
  }

protected:
  uint16_t mFrameNumber;
  int32_t mFrameTimeus;
};