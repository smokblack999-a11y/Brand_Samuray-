package sensor

type Result struct { Blocked bool; Code string }
type Validator struct { MaxID uint32; MaxPayload int }
func (v Validator) Validate(id uint32, payload []byte) Result {
 if id > v.MaxID { return Result{true,"SENSOR_ID_OUT_OF_RANGE"} }
 if len(payload)==0 || len(payload)>v.MaxPayload { return Result{true,"SENSOR_PAYLOAD_INVALID"} }
 return Result{}
}
