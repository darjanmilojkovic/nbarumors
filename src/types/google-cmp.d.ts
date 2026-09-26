/** The slice of Google's CMP (Privacy & messaging) this site calls. */
interface GoogleFundingChoices {
  callbackQueue?: Array<() => void>;
  showRevocationMessage?: () => void;
}

/** The slice of the IAB TCF v2 API the CMP exposes. */
type TcfApi = (
  command: "addEventListener",
  version: 2,
  callback: (tcData: { gdprApplies?: boolean } | null, success: boolean) => void,
) => void;

interface Window {
  googlefc?: GoogleFundingChoices;
  __tcfapi?: TcfApi;
}
