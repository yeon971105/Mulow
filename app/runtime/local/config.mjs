import {providerProfile} from './provider-profiles.mjs';
export function localConfig(origin,key,budgetUsd=5,provider='nebius',{basetenTermsVerified=false}={}){
 const p=providerProfile(provider);
 return {ENABLE_LIVE_RUNS:key?'true':'false',MODEL_API_KEY:key||'',MODEL_BASE_URL:p.origin+'/v1/',MODEL_ALLOWED_ORIGIN:p.origin,MODEL_NAME:p.model,
 OWNER_USER_ID:'local-musepilot-user',SITE_ORIGIN:origin,INPUT_USD_PER_MILLION:p.inputPrice,OUTPUT_USD_PER_MILLION:p.outputPrice,APPROVED_BUDGET_USD:String(budgetUsd),MODEL_CONTEXT_TOKENS:p.context,MODEL_THINKING_MODE:p.thinking,MODEL_JSON_MODE:p.jsonMode,...(p.reasoningEffort?{MODEL_REASONING_EFFORT:p.reasoningEffort}:{}),CALL_TIMEOUT_MS:'300000',PRICING_AND_TOKEN_LIMITS_VERIFIED:provider==='baseten'&&!basetenTermsVerified?'false':'true'};
}

/** Owner-browser relay is a bounded transport, not an assertion of provider credit-only billing. */
export function browserRelayConfig(origin,budgetUsd=100){const p=providerProfile('baseten');return {...localConfig(origin,'relay-transport-no-provider-key',budgetUsd,'baseten'),MODEL_CONTEXT_TOKENS:undefined,MODEL_TRANSPORT:'owner_browser_relay',MAX_CALL_INPUT_BYTES:'80000',MAX_OUTPUT_TOKENS:'12288',MODEL_TOKEN_LIMIT_FIELD:'max_completion_tokens',PRICING_AND_TOKEN_LIMITS_VERIFIED:'true',CALL_TIMEOUT_MS:'180000'};}

/** Same bounded request envelope as the approved browser path; direct native secret transport. */
export function windowsCredentialConfig(origin,key,budgetUsd){const bounded=browserRelayConfig(origin,budgetUsd);return {...bounded,MODEL_API_KEY:key,MODEL_TRANSPORT:'windows_credential_manager'};}

/** Mac session-only pipe; no Keychain or persistent credential access. */
export function macSessionConfig(origin,key,budgetUsd){const bounded=browserRelayConfig(origin,budgetUsd);return {...bounded,ENABLE_LIVE_RUNS:key?'true':'false',MODEL_API_KEY:key||'',MODEL_TRANSPORT:'mac_session_memory'};}
