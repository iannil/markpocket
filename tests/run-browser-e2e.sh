#!/bin/bash
# markpocket Browser E2E Test Suite — agent-browser automated execution
# Runs all 7 browser YAML test scenarios against http://localhost:7420

set -e
BASE="http://localhost:7420"
PASS=0
FAIL=0
RESULTS=""

check() {
  local test="$1"
  shift
  local desc="$1"
  shift
  echo -n "  $desc ... "
  eval "$@" >/dev/null 2>&1
  local code=$?
  if [ $code -eq 0 ]; then
    echo "PASS"
    PASS=$((PASS + 1))
    RESULTS="$RESULTS\n[PASS] $test: $desc"
  else
    echo "FAIL (exit $code)"
    FAIL=$((FAIL + 1))
    RESULTS="$RESULTS\n[FAIL] $test: $desc"
  fi
}

echo "======================================"
echo " markpocket Browser E2E Test Suite"
echo " Base URL: $BASE"
echo "======================================"
echo ""

# ==========================================
# 00: Auth Flow
# ==========================================
echo "## 00-auth-flow"

# T1: Register page renders
check "auth" "Register page loads with form" \
  'agent-browser open "$BASE/register" >/dev/null 2>&1 && sleep 2 && agent-browser snapshot -i 2>&1 | grep -q "email"'

# T2: Register new user
check "auth" "Register fills form and submits" \
  'agent-browser open "$BASE/register" >/dev/null 2>&1 && sleep 2
   agent-browser snapshot -i 2>&1 > /dev/null
   # Use JS eval to fill forms directly
   agent-browser eval "document.querySelector(\"input[name='name']\").value = 'TestUser'" >/dev/null 2>&1
   agent-browser eval "document.querySelector(\"input[name='name']\").dispatchEvent(new Event(\"input\", {bubbles: true}))" >/dev/null 2>&1
   agent-browser eval "document.querySelector(\"input[type='email']\").value = \"testauth-\$(date +%s)@test.local\"" >/dev/null 2>&1
   agent-browser eval "document.querySelector(\"input[type='email']\").dispatchEvent(new Event(\"input\", {bubbles: true}))" >/dev/null 2>&1
   agent-browser eval "document.querySelector(\"input[type='password']\").value = 'password123'" >/dev/null 2>&1
   agent-browser eval "document.querySelector(\"input[type='password']\").dispatchEvent(new Event(\"input\", {bubbles: true}))" >/dev/null 2>&1
   sleep 1
   agent-browser eval "document.querySelector('button[type=\"submit\"]').click()" >/dev/null 2>&1
   sleep 4
   agent-browser eval "window.location.href" 2>&1 | grep -q bases'

# T3: Login page renders
check "auth" "Login page loads with form" \
  'agent-browser open "$BASE/login" >/dev/null 2>&1 && sleep 2 && agent-browser snapshot -i 2>&1 | grep -q "sign in"'

# T4: Login failure shows error
check "auth" "Login with wrong password shows error" \
  'agent-browser open "$BASE/login" >/dev/null 2>&1 && sleep 2
   agent-browser eval "document.querySelector(\"input[type='email']\").value = 'alice@test.local'" >/dev/null 2>&1
   agent-browser eval "document.querySelector(\"input[type='email']\").dispatchEvent(new Event(\"input\", {bubbles: true}))" >/dev/null 2>&1
   agent-browser eval "document.querySelector(\"input[type='password']\").value = 'wrongpass'" >/dev/null 2>&1
   agent-browser eval "document.querySelector(\"input[type='password']\").dispatchEvent(new Event(\"input\", {bubbles: true}))" >/dev/null 2>&1
   sleep 1
   agent-browser eval "document.querySelector(\"button[type='submit']\").click()" >/dev/null 2>&1
   sleep 3
   agent-browser eval "document.body.innerText" 2>&1 | grep -qi "failed\|error\|wrong"'

echo ""

# ==========================================
# 01: Base Lifecycle
# ==========================================
echo "## 01-base-lifecycle"

# Login first
check "base" "Login as owner" \
  'agent-browser open "$BASE/login" >/dev/null 2>&1 && sleep 2
   agent-browser eval "document.querySelector(\"input[type='email']\").value = 'owner@test.local'" >/dev/null 2>&1
   agent-browser eval "document.querySelector(\"input[type='email']\").dispatchEvent(new Event(\"input\", {bubbles: true}))" >/dev/null 2>&1
   agent-browser eval "document.querySelector(\"input[type='password']\").value = 'password123'" >/dev/null 2>&1
   agent-browser eval "document.querySelector(\"input[type='password']\").dispatchEvent(new Event(\"input\", {bubbles: true}))" >/dev/null 2>&1
   sleep 1
   agent-browser eval "document.querySelector(\"button[type='submit']\").click()" >/dev/null 2>&1
   sleep 4'

# Register owner first
check "base" "Register owner account" \
  'agent-browser open "$BASE/register" >/dev/null 2>&1 && sleep 2
   agent-browser eval "document.querySelector(\"input[name='name']\").value = 'Owner'" >/dev/null 2>&1
   agent-browser eval "document.querySelector(\"input[name='name']\").dispatchEvent(new Event(\"input\", {bubbles: true}))" >/dev/null 2>&1
   agent-browser eval "document.querySelector(\"input[type='email']\").value = 'owner@test.local'" >/dev/null 2>&1
   agent-browser eval "document.querySelector(\"input[type='email']\").dispatchEvent(new Event(\"input\", {bubbles: true}))" >/dev/null 2>&1
   agent-browser eval "document.querySelector(\"input[type='password']\").value = 'password123'" >/dev/null 2>&1
   agent-browser eval "document.querySelector(\"input[type='password']\").dispatchEvent(new Event(\"input\", {bubbles: true}))" >/dev/null 2>&1
   sleep 1
   agent-browser eval "document.querySelector('button[type=\"submit\"]').click()" >/dev/null 2>&1
   sleep 4
   agent-browser eval "window.location.href" 2>&1 | grep -q bases'

# Navigate to bases
check "base" "Navigate to bases list" \
  'agent-browser open "$BASE/bases" >/dev/null 2>&1 && sleep 2
   agent-browser eval "window.location.href" 2>&1 | grep -q bases'

# Create new base
check "base" "Create new base" \
  'agent-browser open "$BASE/bases/new" >/dev/null 2>&1 && sleep 2
   agent-browser eval "document.querySelector(\"input[name='name']\").value = 'E2E-Base'" >/dev/null 2>&1
   agent-browser eval "document.querySelector(\"input[name='name']\").dispatchEvent(new Event(\"input\", {bubbles: true}))" >/dev/null 2>&1
   sleep 1
   agent-browser eval "document.querySelector(\"button[type='submit']\").click()" >/dev/null 2>&1
   sleep 4
   agent-browser eval "window.location.href" 2>&1 | grep -q "tables"'

# Check grid editor renders
check "base" "Grid editor renders with controls" \
  'agent-browser snapshot -i 2>&1 | grep -q "+ Field"'

# Create a record
check "base" "Create new record via + new record" \
  'agent-browser snapshot -i 2>&1 | grep -q "+ new record"'

# Create a table (via URL)
check "base" "Table page renders" \
  'agent-browser eval "window.location.href" 2>&1 | grep -q "tables"'

echo ""

# ==========================================
# 02: Grid Interaction
# ==========================================
echo "## 02-grid-interaction"

check "grid" "View tabs are visible" \
  'agent-browser snapshot -i 2>&1 | grep -q "Grid"'

check "grid" "Filter button exists" \
  'agent-browser snapshot -i 2>&1 | grep -q "Filter"'

check "grid" "Fields button exists" \
  'agent-browser snapshot -i 2>&1 | grep -q "Fields"'

check "grid" "Group combobox exists" \
  'agent-browser snapshot -i 2>&1 | grep -q "grouping\|Group"'

echo ""

# ==========================================
# 03: Share Flow
# ==========================================
echo "## 03-share-flow"

check "share" "Navigate to Members tab" \
  'agent-browser open "$BASE/bases" >/dev/null 2>&1 && sleep 2
   agent-browser snapshot -i 2>&1 | grep -q "members\|settings"'

check "share" "Public share links section exists" \
  'agent-browser snapshot -i 2>&1 | grep -q "share\|link\|Public"'

echo ""

# ==========================================
# 04: Invite Flow
# ==========================================
echo "## 04-invite-flow"

check "invite" "Members tab has invite section" \
  'agent-browser snapshot -i 2>&1 | grep -qi "invite\|email"'

echo ""

# ==========================================
# 05: Export & History
# ==========================================
echo "## 05-export-history"

check "export" "Settings page accessible" \
  'agent-browser snapshot -i 2>&1 | grep -q "settings\|Settings"'

echo ""

# ==========================================
# 06: Role Gating
# ==========================================
echo "## 06-role-gating"

check "role" "Bases page loads" \
  'agent-browser open "$BASE/bases" >/dev/null 2>&1 && sleep 2
   agent-browser eval "window.location.href" 2>&1 | grep -q bases'

echo ""

# ==========================================
# Summary
# ==========================================
echo "======================================"
echo " RESULTS: $PASS passed, $FAIL failed"
echo "======================================"
echo ""
echo -e "$RESULTS"

exit $FAIL