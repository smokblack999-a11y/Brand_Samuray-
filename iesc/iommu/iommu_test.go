package iommu
import "testing"
func TestUnsupportedATS(t *testing.T){f:=Analyze(Config{Valid:true,V:true,ENATS:true},Capabilities{});if len(f)==0||f[0].Code!="ATS_UNSUPPORTED"{t.Fatalf("got %#v",f)}}
func TestT2GPARequiresSupport(t *testing.T){f:=Analyze(Config{Valid:true,V:true,T2GPA:true,ENATS:true},Capabilities{ATS:true});if len(f)==0{t.Fatal("expected finding")}}
func TestPDTValidation(t *testing.T){f:=Analyze(Config{Valid:true,V:true,PDTV:true,PDTMode:0},Capabilities{});if len(f)==0{t.Fatal("expected finding")}}
func TestTranslatedContext(t *testing.T){f:=Analyze(Config{Valid:true,V:true,IOSATPMode:1,IOSATPAddress:4096,IOHGATPMode:1,IOHGATPAddress:8192},Capabilities{SecondStage:true});for _,x:=range f{if x.Severity=="error"{t.Fatalf("unexpected %#v",f)}}}
