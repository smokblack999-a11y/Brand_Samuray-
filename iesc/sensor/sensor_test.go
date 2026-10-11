package sensor
import "testing"
func TestValidator(t *testing.T){v:=Validator{MaxID:10,MaxPayload:4};cases:=[]struct{id uint32;p []byte;blocked bool}{{10,[]byte("ok"),false},{11,[]byte("ok"),true},{1,nil,true},{1,[]byte("12345"),true}};for _,c:=range cases{if v.Validate(c.id,c.p).Blocked!=c.blocked{t.Fatalf("case %#v",c)}}}
