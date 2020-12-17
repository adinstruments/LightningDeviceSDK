#pragma once

template <class T, int Size>
class RingBufferSized
{
public:
  typedef int TIndex;

  RingBufferSized() : mIn(0), mOut(0)
  {
  }

  void Clear()
  {
    mOut = mIn; // buffer is empty. The index needs to be one sample ahead when adding data.
  }

  TIndex GetCount() const
  {
    TIndex result = mIn - mOut; // does a subtraction to determine how much data there is.
    if (result < 0)
      result += Size;
    return result;
  }

  TIndex GetSpace() const
  {
    return (Size - 1) - GetCount();
  }

  // The reason why this is the ring buffer is thread/interrupt safe is because
  // the input thread/interrupt only touches/modify mIn (the input index). While
  // the output process only touches mOut.

  // The assumption is that there is only one thread/interrupt adding to this buffer.
  // Each signal needs it's own ring buffer. If there is one ADC driving data into these
  // ring buffers, then samples may not arrive at the same time.

  bool Push(T val)
  {
    if (GetSpace())
    {
      mBuffer[mIn++] = val;
      if (mIn >= Size)
        mIn -= Size;
      return true;
    }
    return false;
  }

  //Returns num pushed
  int Push(const T *val, TIndex nToPushIn)
  {
    TIndex nToPushRemain = nToPushIn;
    TIndex space = GetSpace();

    if (nToPushRemain > space)
      nToPushRemain = space; //limit to available space
    else
      space = nToPushIn; //space is now number that will be pushed

    if (nToPushRemain)
    {                                   //There is space
      TIndex lenToCopy1 = (Size - mIn); //space available before wrapping
      if (lenToCopy1 > nToPushRemain)
        lenToCopy1 = nToPushRemain;
      memcpy(mBuffer + mIn, val, lenToCopy1 * sizeof(T));
      mIn += lenToCopy1;
      if (mIn >= Size)
        mIn -= Size;
      nToPushRemain -= lenToCopy1;
      if (nToPushRemain)
      { //still some left to copy, wrap to start of buffer
        memcpy(mBuffer, val + lenToCopy1, nToPushRemain * sizeof(T));
        mIn += nToPushRemain;
        if (mIn >= Size)
          mIn -= Size;
      }
    }
    return space; //Space is number pushed.
  }

  bool Get(T *val) const
  {
    if (GetCount())
    {
      *val = mBuffer[mOut];
      return true;
    }
    return false;
  }

  const T &Get() const
  {
    return mBuffer[mOut];
  }

  const T &GetNext()
  {
    const T &result = mBuffer[mOut++];
    if (mOut >= Size)
      mOut -= Size;
    return result;
  }

  bool GetNext(T *val)
  {
    if (GetCount())
    {
      *val = mBuffer[mOut++];
      if (mOut >= Size)
        mOut -= Size;
      return true;
    }
    return false;
  }

  bool NextOut()
  {
    if (GetCount())
    {
      mOut++;
      if (mOut >= Size)
        mOut -= Size;
      return true;
    }
    return false;
  }

protected:
  T mBuffer[Size];
  volatile TIndex mIn;
  volatile TIndex mOut;
};