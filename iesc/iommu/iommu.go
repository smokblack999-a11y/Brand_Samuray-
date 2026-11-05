package iommu

type Capabilities struct { ATS, PRI, HPM, MSIPageTable, SecondStage bool }
type Config struct {
 Valid bool
 V bool
 ENATS bool
 ENPRI bool
 PRPR bool
 T2GPA bool
 PDTV bool
 PDTMode uint8
 PDTAddress uint64
 IOSATPMode uint8
 IOSATPAddress uint64
 IOHGATPMode uint8
 IOHGATPAddress uint64
 MSITPMode uint8
 SXL uint8
 SBE uint8
}
type Finding struct { Severity string `json:"severity"`; Code string `json:"code"`; Message string `json:"message"` }

func Analyze(c Config, cap Capabilities) []Finding {
 out:=[]Finding{}
 add:=func(s,code,msg string){out=append(out,Finding{s,code,msg})}
 if !c.Valid { add("error","DC_INVALID","device context is not valid"); return out }
 if !c.V { return out }
 if c.ENATS && !cap.ATS { add("error","ATS_UNSUPPORTED","EN_ATS is enabled but ATS capability is absent") }
 if c.ENPRI && !cap.PRI { add("error","PRI_UNSUPPORTED","EN_PRI is enabled but PRI capability is absent") }
 if c.PRPR && !c.ENPRI { add("error","PRPR_WITHOUT_PRI","PRPR requires PRI") }
 if c.T2GPA && (!c.ENATS || !cap.SecondStage) { add("error","T2GPA_INVALID","T2GPA requires ATS and second-stage translation support") }
 if c.PDTV {
  if c.PDTMode==0 { add("error","PDT_MODE_BARE","PDT is enabled but pdtp mode is Bare") }
  if c.PDTAddress==0 { add("error","PDT_ROOT_MISSING","PDT is enabled but its root address is zero") }
 }
 if c.IOSATPMode!=0 && c.IOSATPAddress==0 { add("error","IOSATP_ROOT_MISSING","first-stage translation has no root address") }
 if c.IOHGATPMode!=0 {
  if !cap.SecondStage { add("error","SECOND_STAGE_UNSUPPORTED","second-stage translation configured without capability") }
  if c.IOHGATPAddress==0 { add("error","IOHGATP_ROOT_MISSING","second-stage translation has no root address") }
 }
 if c.IOHGATPMode==0 && c.MSITPMode!=0 { add("error","MSITP_WITHOUT_IOMMU","MSI page-table mode requires second-stage translation") }
 if c.SXL>2 { add("error","SXL_INVALID","SXL contains unsupported encoding") }
 if c.SBE>1 { add("error","SBE_INVALID","SBE contains unsupported encoding") }
 if c.IOSATPMode==0 && c.IOHGATPMode==0 { add("warning","NO_TRANSLATION","no first- or second-stage translation configured") }
 return out
}
