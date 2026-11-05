package main

import(
 "encoding/json";"flag";"fmt";"os"
 "github.com/smokblack999-a11y/Brand_Samuray-/iesc/engine"
 "github.com/smokblack999-a11y/Brand_Samuray-/iesc/iommu"
 "github.com/smokblack999-a11y/Brand_Samuray-/iesc/sensor"
 "github.com/smokblack999-a11y/Brand_Samuray-/iesc/wal"
)
type Input struct{Capabilities iommu.Capabilities `json:"capabilities"`;Config iommu.Config `json:"config"`;SensorID uint32 `json:"sensor_id"`;Payload string `json:"payload"`}
func main(){
 inPath:=flag.String("input","","JSON configuration");walPath:=flag.String("wal","iesc.wal","authenticated WAL");key:=flag.String("key","","HMAC key");flag.Parse()
 if *inPath==""||*key==""{fmt.Fprintln(os.Stderr,"usage: iesc -input config.json -key SECRET [-wal file]");os.Exit(2)}
 b,err:=os.ReadFile(*inPath);if err!=nil{fail(err)};var in Input;if err=json.Unmarshal(b,&in);err!=nil{fail(err)}
 w,err:=wal.Open(*walPath,[]byte(*key));if err!=nil{fail(err)};defer w.Close()
 e:=engine.New(w,sensor.Validator{MaxID:1024,MaxPayload:256})
 findings,err:=e.AnalyzeIOMMU(in.Config,in.Capabilities);if err!=nil{fail(err)}
 accepted,err:=e.ProcessSensor(in.SensorID,[]byte(in.Payload));if err!=nil{fail(err)}
 out:=struct{IOMMU []iommu.Finding `json:"iommu"`;SensorAccepted bool `json:"sensor_accepted"`;Dropped uint64 `json:"dropped"`}{findings,accepted,e.DroppedCount()}
 enc,_:=json.MarshalIndent(out,"","  ");fmt.Println(string(enc))
 for _,f:=range findings{if f.Severity=="error"{os.Exit(1)}};if !accepted{os.Exit(1)}
}
func fail(err error){fmt.Fprintln(os.Stderr,"iesc:",err);os.Exit(2)}
