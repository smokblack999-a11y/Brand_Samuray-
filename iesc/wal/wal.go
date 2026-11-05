package wal

import (
 "crypto/hmac"
 "crypto/sha256"
 "encoding/binary"
 "errors"
 "io"
 "os"
)

const magic uint32=0x49455343
const version uint16=1
const headerSize=52
const maxPayload uint32=1<<20

type Event struct { Seq uint64; Kind uint16; Payload []byte }
type WAL struct { f *os.File; key []byte }

func Open(path string,key []byte)(*WAL,error){
 if len(key)<16{return nil,errors.New("wal: HMAC key must be at least 16 bytes")}
 f,err:=os.OpenFile(path,os.O_CREATE|os.O_RDWR|os.O_APPEND,0600);if err!=nil{return nil,err}
 return &WAL{f:f,key:append([]byte(nil),key...)},nil
}
func(w *WAL)Close()error{return w.f.Close()}
func(w *WAL)frame(e Event)([]byte,error){
 if uint64(len(e.Payload))>uint64(maxPayload){return nil,errors.New("wal: payload too large")}
 b:=make([]byte,headerSize+len(e.Payload))
 binary.BigEndian.PutUint32(b[0:4],magic);binary.BigEndian.PutUint16(b[4:6],version)
 binary.BigEndian.PutUint16(b[6:8],e.Kind);binary.BigEndian.PutUint64(b[8:16],e.Seq)
 binary.BigEndian.PutUint32(b[16:20],uint32(len(e.Payload)));copy(b[headerSize:],e.Payload)
 m:=hmac.New(sha256.New,w.key);m.Write(b[:20]);m.Write(e.Payload);copy(b[20:52],m.Sum(nil))
 return b,nil
}
func(w *WAL)Append(e Event,syncNow bool)error{
 b,err:=w.frame(e);if err!=nil{return err};if _,err=w.f.Write(b);err!=nil{return err}
 if syncNow{return w.f.Sync()};return nil
}
func(w *WAL)Recover()([]Event,error){
 if _,err:=w.f.Seek(0,io.SeekStart);err!=nil{return nil,err}
 var out []Event;var off int64
 for{
  start:=off;h:=make([]byte,headerSize);n,err:=io.ReadFull(w.f,h);off+=int64(n)
  if err==io.EOF&&n==0{break};if err!=nil{return w.truncate(start,out)}
  if binary.BigEndian.Uint32(h[:4])!=magic||binary.BigEndian.Uint16(h[4:6])!=version{return w.truncate(start,out)}
  kind:=binary.BigEndian.Uint16(h[6:8]);seq:=binary.BigEndian.Uint64(h[8:16]);l:=binary.BigEndian.Uint32(h[16:20])
  if l>maxPayload{return w.truncate(start,out)}
  p:=make([]byte,l);if _,err=io.ReadFull(w.f,p);err!=nil{return w.truncate(start,out)};off+=int64(l)
  m:=hmac.New(sha256.New,w.key);m.Write(h[:20]);m.Write(p);if !hmac.Equal(h[20:52],m.Sum(nil)){return w.truncate(start,out)}
  if len(out)>0&&seq<=out[len(out)-1].Seq{return w.truncate(start,out)}
  out=append(out,Event{seq,kind,p})
 }
 _,err:=w.f.Seek(0,io.SeekEnd);return out,err
}
func(w *WAL)truncate(off int64,out []Event)([]Event,error){if err:=w.f.Truncate(off);err!=nil{return nil,err};_,err:=w.f.Seek(0,io.SeekEnd);return out,err}
