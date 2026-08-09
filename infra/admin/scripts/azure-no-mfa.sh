#!/usr/bin/env bash
# Find out what is making workshop attendees enrol in Microsoft Authenticator,
# and switch off the parts of it that are tenant settings.
#
# A workshop account exists for a few hours, is read off a slide, and is deleted
# with the run. Enrolling it in an authenticator app protects nothing and costs
# a room of thirty people five minutes each, so nothing this repo provisions
# asks for a second factor: the Entra users Terraform creates carry no MFA
# setting (workshops/azure-base) and the Google accounts are created without a
# forced reset (directory.ts). Every prompt an attendee sees comes from tenant
# policy, and there are four separate places it can come from:
#
#   1. Security defaults — on in every tenant created since late 2019.
#   2. The Authenticator registration campaign — a nudge, configured under the
#      authentication methods policy, that asks users to set up Authenticator
#      during sign-in. Survives security defaults being off, and is the usual
#      answer to "I turned security defaults off and it still asks".
#   3. A Conditional Access policy with an MFA grant control — including the
#      Microsoft-managed ones that appear in tenants without anyone adding them.
#   4. Legacy per-user MFA, set on the account itself rather than by policy.
#
# Each is checked on its own and a failure in one does not stop the rest: they
# are unrelated settings, they need different permissions to read, and the
# whole point of running this is to find the one that is still on.
#
# There is also a fifth thing that is none of these and cannot be switched off
# — see the note at the end.
#
# Run as a tenant Global Administrator. This is a one-time tenant change, and
# nothing here should become a permission the per-run automation holds.
#
# Usage:
#   az login
#   ./scripts/azure-no-mfa.sh                        # report
#   ./scripts/azure-no-mfa.sh bouncy-penguin@dom.io  # report, plus that account
#   APPLY=1 ./scripts/azure-no-mfa.sh                # and switch off what it can
set -uo pipefail

GRAPH="https://graph.microsoft.com/v1.0"
BETA="https://graph.microsoft.com/beta"
APPLY="${APPLY:-0}"
USER_UPN="${1:-}"

# Set by any check that comes back "this one is still on", so the summary can
# say whether the run actually explained anything.
FOUND=""

command -v az >/dev/null 2>&1 || {
  echo "az CLI not found — install it, or make the same calls in Graph Explorer." >&2
  exit 1
}

# ---------------------------------------------------------------- helpers

# GET a Graph URL. Prints the body on success; on failure prints nothing and
# leaves the error in GRAPH_ERR. Never aborts the script — a check that cannot
# read its setting is a check that is skipped, not a reason to stop.
GRAPH_ERR=""
graph_get() {
  local url="$1" out
  if out=$(az rest --method get --url "${url}" -o json 2>&1); then
    GRAPH_ERR=""
    printf '%s' "${out}"
    return 0
  fi
  # az prints multi-line noise around the real message; keep the line that
  # names the Graph error, which is the one that says which permission is
  # missing.
  GRAPH_ERR=$(printf '%s' "${out}" | grep -iE "forbidden|unauthorized|insufficient|denied|error" | head -2)
  [[ -n "${GRAPH_ERR}" ]] || GRAPH_ERR=$(printf '%s' "${out}" | head -2)
  return 1
}

# Why a read failed, and what to do about it. The Azure CLI signs in as its own
# first-party application, and that application is not pre-consented for every
# Graph permission a Global Administrator personally holds — so "403" here
# often means "the CLI cannot ask for this", not "you cannot read this".
explain_read_failure() {
  local what="$1" perm="$2"
  echo "   Could not read ${what}. Needs ${perm}."
  [[ -n "${GRAPH_ERR}" ]] && echo "   Graph said: ${GRAPH_ERR}"
  echo "   A Global Admin getting 403 here is normal: it is the az CLI's own"
  echo "   app that lacks the scope, not your account. Read it in Graph"
  echo "   Explorer (https://aka.ms/ge), or with Graph PowerShell:"
  echo "     Connect-MgGraph -Scopes ${perm}"
}

# JSON field off a blob, without requiring jq: python3 ships on macOS and in
# every image this is likely to run in, and az itself is a python program.
json_get() {
  python3 -c '
import json,sys
doc = json.loads(sys.stdin.read() or "{}")
for key in sys.argv[1].split("."):
    if not isinstance(doc, dict):
        doc = None
        break
    doc = doc.get(key)
# Booleans go out as JSON spells them, not as Python prints them — these lines
# are read by a human comparing them against what the portal shows.
if isinstance(doc, bool):
    print("true" if doc else "false")
else:
    print("" if doc is None else json.dumps(doc) if isinstance(doc, (dict, list)) else doc)
' "$1" 2>/dev/null
}

echo
if ! account=$(az account show -o json 2>&1); then
  echo "Not signed in — run: az login" >&2
  exit 1
fi
echo ">> Tenant $(printf '%s' "${account}" | json_get tenantId), signed in as $(printf '%s' "${account}" | json_get user.name)"
[[ "${APPLY}" == "1" ]] && echo ">> APPLY=1 — will switch off what it can" || echo ">> Report only (APPLY=1 to change anything)"
echo

# ------------------------------------------------------------ 1. defaults

echo "1. Security defaults"
sd_url="${GRAPH}/policies/identitySecurityDefaultsEnforcementPolicy"
if sd=$(graph_get "${sd_url}"); then
  # az renders JSON booleans python-style in some output modes, so compare
  # case-insensitively rather than against a bare "true".
  enabled=$(printf '%s' "${sd}" | json_get isEnabled | tr '[:upper:]' '[:lower:]')
  if [[ "${enabled}" == "false" ]]; then
    echo "   Off. Not this."
  elif [[ "${APPLY}" == "1" ]]; then
    if az rest --method patch --url "${sd_url}" \
      --headers "Content-Type=application/json" \
      --body '{"isEnabled":false}' >/dev/null 2>&1; then
      echo "   ON -> turned off."
    else
      echo "   ON, and the change failed. Entra admin center -> Overview ->"
      echo "   Properties -> Manage security defaults."
      FOUND="yes"
    fi
  else
    echo "   ON. Re-run with APPLY=1, or turn it off in the Entra admin center."
    FOUND="yes"
  fi
else
  explain_read_failure "security defaults" "Policy.ReadWrite.SecurityDefaults"
  echo "   Carrying on — if you have already turned them off in the portal,"
  echo "   this check had nothing to tell you anyway."
fi
echo

# -------------------------------------------- 2. registration campaign

# The one that usually survives turning security defaults off. It lives on the
# authentication methods policy and its whole purpose is to interrupt sign-in
# and ask the user to set up Microsoft Authenticator.
echo "2. Authenticator registration campaign"
amp_url="${GRAPH}/policies/authenticationMethodsPolicy"
if amp=$(graph_get "${amp_url}"); then
  campaign=$(printf '%s' "${amp}" | json_get registrationEnforcement.authenticationMethodsRegistrationCampaign)
  state=$(printf '%s' "${campaign}" | python3 -c 'import json,sys; d=sys.stdin.read().strip(); print((json.loads(d) or {}).get("state","") if d else "")' 2>/dev/null)

  if [[ -z "${state}" || "${state}" == "disabled" ]]; then
    echo "   ${state:-not configured}. Not this."
  else
    echo "   state=${state} — this asks users to set up Authenticator at sign-in."
    if [[ "${APPLY}" == "1" ]]; then
      # Print what is there before changing it: this is a merge patch into a
      # nested object, so the targeting under it is being written over and
      # this line is the only record of what it was.
      echo "   Current setting, for the record:"
      echo "   ${campaign}"
      if az rest --method patch --url "${amp_url}" \
        --headers "Content-Type=application/json" \
        --body '{"registrationEnforcement":{"authenticationMethodsRegistrationCampaign":{"state":"disabled"}}}' >/dev/null 2>&1; then
        echo "   -> disabled."
      else
        echo "   -> change failed. Entra admin center -> Protection ->"
        echo "      Authentication methods -> Registration campaign."
        FOUND="yes"
      fi
    else
      echo "   Re-run with APPLY=1, or: Entra admin center -> Protection ->"
      echo "   Authentication methods -> Registration campaign."
      FOUND="yes"
    fi
  fi
else
  explain_read_failure "the authentication methods policy" "Policy.ReadWrite.AuthenticationMethod"
fi
echo

# ---------------------------------------------------- 3. conditional access

echo "3. Conditional Access"
if ca=$(graph_get "${GRAPH}/identity/conditionalAccess/policies"); then
  hits=$(printf '%s' "${ca}" | python3 -c '
import json, sys
policies = (json.load(sys.stdin) or {}).get("value") or []
rows = []
for p in policies:
    if p.get("state") not in ("enabled", "enabledForReportingButNotEnforced"):
        continue
    grant = p.get("grantControls") or {}
    controls = [c for c in (grant.get("builtInControls") or [])]
    strength = ((grant.get("authenticationStrength") or {}).get("displayName") or "")
    if "mfa" in controls or strength:
        rows.append("   - %s [%s]%s%s" % (
            p.get("displayName", "(unnamed)"),
            p.get("state"),
            (" controls=" + ",".join(controls)) if controls else "",
            (" strength=" + strength) if strength else "",
        ))
print("\n".join(rows))
print("TOTAL=%d" % len(policies))
' 2>/dev/null)
  total=$(printf '%s' "${hits}" | sed -n 's/^TOTAL=//p')
  rows=$(printf '%s' "${hits}" | sed '/^TOTAL=/d' | sed '/^$/d')

  if [[ -z "${rows}" ]]; then
    echo "   ${total:-0} policies, none requiring MFA. Not this."
  else
    echo "   These require MFA:"
    echo "${rows}"
    echo
    echo "   Exclude the attendee accounts, or scope the policy to staff only —"
    echo "   attendee UPNs are all on the workshop's verified domain, so a"
    echo "   group or domain exclusion covers every run. Microsoft-managed"
    echo "   policies can be set to 'Off' in the same place."
    echo "   Not changed automatically: a CA policy is real security for"
    echo "   everyone else in the tenant, and narrowing it is your call."
    FOUND="yes"
  fi
else
  explain_read_failure "Conditional Access policies" "Policy.Read.All"
  echo "   (A tenant without Entra ID P1 has no CA policies, and this call"
  echo "   fails there too — that case is a pass, not a problem.)"
fi
echo

# --------------------------------------------------- 4. legacy per-user MFA

echo "4. Legacy per-user MFA"
if [[ -z "${USER_UPN}" ]]; then
  echo "   Skipped — it is set per account, so pass an attendee address that is"
  echo "   being prompted:  $(basename "$0") bouncy-penguin@yourdomain"
else
  if u=$(graph_get "${GRAPH}/users/${USER_UPN}?\$select=id,userPrincipalName"); then
    uid=$(printf '%s' "${u}" | json_get id)
    echo "   ${USER_UPN} (${uid})"

    if req=$(graph_get "${BETA}/users/${uid}/authentication/requirements"); then
      state=$(printf '%s' "${req}" | json_get perUserMfaState)
      if [[ "${state}" == "disabled" || -z "${state}" ]]; then
        echo "   perUserMfaState=${state:-unset}. Not this."
      else
        echo "   perUserMfaState=${state} — this account is required to register."
        echo "   Clear it with:"
        echo "     az rest --method patch \\"
        echo "       --url ${BETA}/users/${uid}/authentication/requirements \\"
        echo "       --headers \"Content-Type=application/json\" \\"
        echo "       --body '{\"perUserMfaState\":\"disabled\"}'"
        echo "   Per account, so it has to be done for each — if this is what is"
        echo "   set, say so and the runner can clear it at provision time."
        FOUND="yes"
      fi
    else
      explain_read_failure "per-user MFA state" "Policy.ReadWrite.AuthenticationMethod"
    fi

    # What the account has actually registered. Not a cause, but it settles
    # whether the prompt is enrolment (nothing registered yet) or a challenge
    # against something already set up.
    if reg=$(graph_get "${GRAPH}/reports/authenticationMethods/userRegistrationDetails/${uid}"); then
      echo "   Registered: $(printf '%s' "${reg}" | json_get methodsRegistered)"
      echo "   MFA capable: $(printf '%s' "${reg}" | json_get isMfaCapable)"
    else
      explain_read_failure "registration details" "AuditLog.Read.All"
    fi
  else
    explain_read_failure "user ${USER_UPN}" "User.Read.All"
  fi
fi
echo

# --------------------------------------------------------------- summary

if [[ -n "${FOUND}" ]]; then
  echo ">> Something above is still requiring MFA. Fix it and re-test with an"
  echo "   account from a fresh run — an attendee who already enrolled stays"
  echo "   enrolled, so an old account will keep signing in the way it did."
else
  echo ">> Nothing in the tenant settings above is asking for MFA."
fi

cat <<'NOTE'

>> The one this cannot turn off

Microsoft enforces MFA on sign-ins to the Azure portal itself, tenant-wide and
independent of security defaults, registration campaigns and Conditional Access
— phased in from October 2024 for the portal and from October 2025 for
CLI/PowerShell/IaC, with the tenant postponement windows now closed. If every
check above is clear and attendees are still prompted when they open
portal.azure.com, that is why, and there is no setting for it.

The way to keep an authenticator app out of a workshop under that enforcement
is a Temporary Access Pass: a time-limited passcode issued per user that
satisfies MFA with no app, no phone and no enrolment. The attendee signs in
with the code instead of registering anything. It needs the TAP method enabled
(Entra admin center -> Protection -> Authentication methods -> Temporary Access
Pass) and one pass issued per attendee, which the runner does not do today —
an attendee's Azure password is currently the same one as their Google account,
and a TAP would replace it.

Verify against your own tenant before planning a room around either answer.
NOTE
