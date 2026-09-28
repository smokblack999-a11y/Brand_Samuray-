package engine

import (
 "encoding/json"
 "sync/atomic"
 "time"
 "github.com/smokblack999-a11y/Brand_Samuray-/iesc/iommu"
 "github.com/smokblack999-a11y/Brand_Samuray-/iesc/sensor"
 "github.com/smokblack999-a11y/Brand_Samuray-/iesc/wal"
)

type SecurityEvent struct {
 Version uint16 `json:"version"`
 Seq uint64 `json:"seq"`
 TimeUnixNano int64 `json:"time_unix_nano"`
 Source string `json:"source"`
 Severity string `json:"severity"`
 Code string `json:"code"`
 SensorID uint32 `json:"sensor_id,omitempty"`
}
type Engine struct { Sensor sensor.Validator; dropped uint64; nextSeq uint64; WAL *wal.WAL }
func New(w *wal.WAL,v sensor.Validator)*Engine{return &Engine{Sensor:v,WAL:w}}
func(e *Engine) record(source,severity,code string,id uint32)error{
 seq:=atomic.AddUint64(&e.nextSeq,1)
 b,err:=json.Marshal(SecurityEvent{1,seq,time.Now().UnixNano(),source,severity,code,id});if err!=nil{return err}
 return e.WAL.Append(wal.Event{Seq:seq,Kind:1,Payload:b},true)
}
func(e *Engine)ProcessSensor(id uint32,payload []byte)(bool,error){
 r:=e.Sensor.Validate(id,payload);if !r.Blocked{return true,nil}
 if err:=e.record("sensor","high",r.Code,id);err!=nil{return false,err};atomic.AddUint64(&e.dropped,1);return false,nil
}
func(e *Engine)AnalyzeIOMMU(c iommu.Config,cap iommu.Capabilities)([]iommu.Finding,error){
 f:=iommu.Analyze(c,cap);if len(f)==0{return f,nil}
 if err:=e.record("iommu","high",f[0].Code,0);err!=nil{return f,err};return f,nil
}
func(e *Engine)DroppedCount()uint64{return atomic.LoadUint64(&e.dropped)}
