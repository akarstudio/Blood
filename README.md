# Blood Group Finder Bangladesh

A complete, responsive, secure, and production-oriented healthcare platform designed to help people across Bangladesh find voluntary blood donors by blood group and geographic location (Divisions, Districts, and Upazilas).

---

## 1. Executive Summary & Capabilities

- **Primary Country:** Bangladesh (Operating in all 8 administrative divisions and 64 districts).
- **Timezone:** Bangladesh Standard Time (`Asia/Dhaka`, UTC+6) for all dates, donation interval computations, and audit logs.
- **Language:** 100% English interface across all public, donor, and administrative views.
- **No Blood Request Feature in this Version:** Focused strictly on donor discovery, registration, contact verification, donor profile management, administrative review, and centralized availability policy enforcement.
- **Authoritative Availability Policy:** Defaults to **3 calendar months** (not a 90-day static count), handling month-end transitions (e.g., January 31 $\rightarrow$ April 30) and leap years.
- **Multi-Role RBAC:** Super Admin, Admin, Donor Manager, Data Entry Operator, Import/Export Operator, Viewer/Auditor.
- **Zero-Pill Discipline & Healthcare UI:** Designed according to the Universal Frontend Design Constitution with high contrast, accessible controls, tabular numbers, and zero AI-slop cliches.

---

## 2. Architecture & Tech Stack

| Layer | Technology |
|---|---|
| Frontend Framework | React 19 (TypeScript strict mode) |
| Build Tool | Vite |
| Styling | Tailwind CSS v4 with custom healthcare palette |
| Icons | Lucide React |
| Authentication | Firebase Authentication (Email/Password & Google Sign-In) |
| Database | Cloud Firestore (Enterprise Edition) |
| Security | Declarative Firestore Security Rules with ABAC & immutable audit logs |
| Data Processing | SheetJS (XLSX/CSV) with CSV Formula Injection Safeguards |
| Testing Engine | Vitest |

---

## 3. Database Schema (Cloud Firestore)

### `users/{userId}`
- `uid` (string): Firebase Auth UID
- `email` (string): Lowercase normalized email
- `displayName` (string): User full name or pseudonym
- `roleIds` (array of strings): `['super_admin']`, `['admin']`, `['donor_manager']`, etc.
- `accountStatus` (string): `'active' | 'suspended' | 'deactivated'`
- `createdAt` (ISO timestamp)
- `updatedAt` (ISO timestamp)

### `donors/{donorId}`
- `uid` (string, optional): Linked Firebase Auth user UID
- `fullName` (string): Donor's legal/display name
- `normalizedName` (string): Lowercase name for indexing
- `email` (string): Contact email
- `normalizedEmail` (string): Lowercase trimmed email for duplicate prevention
- `phone` (string): Bangladesh mobile number (`01XXXXXXXXX`)
- `normalizedPhone` (string): Normalized 11-digit mobile string
- `bloodGroup` (string): `'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-'`
- `division` (string): e.g. `'Dhaka'`, `'Chattogram'`, `'Sylhet'`, etc.
- `district` (string): e.g. `'Dhaka'`, `'Cox\'s Bazar'`, `'Cumilla'`
- `upazila` (string): e.g. `'Dhanmondi'`, `'Mirpur'`, `'Pahartali'`
- `lastDonationDate` (string, YYYY-MM-DD): Recorded donation date
- `eligibilityDate` (string, YYYY-MM-DD): Calculated next eligible donation date
- `declaredAvailability` (string): `'available' | 'unavailable'` (Donor opt-out preference)
- `calculatedAvailability` (string): `'available' | 'unavailable'` (Authoritative policy status)
- `contactVerificationStatus` (string): `'unverified' | 'pending' | 'verified'`
- `approvalStatus` (string): `'pending' | 'approved' | 'rejected'`
- `accountStatus` (string): `'active' | 'suspended' | 'deactivated'`
- `publicContactConsent` (boolean): Whether donor allows contact
- `publicProfileConsent` (boolean): Whether donor allows profile listing
- `contactVisibilityPreference` (string): `'public' | 'registered_only' | 'hidden'`
- `preferredContactMethod` (string): `'phone' | 'whatsapp' | 'sms' | 'email'`
- `privacyConsentVersion` (string): Consent version (`'1.0'`)
- `privacyConsentAt` (ISO timestamp)
- `approvedBy` (string, optional): UID of approving administrator
- `approvedAt` (ISO timestamp, optional)
- `rejectionReason` (string, optional)
- `createdAt` (ISO timestamp)
- `updatedAt` (ISO timestamp)

### `systemSettings/availabilityPolicy`
- `minimumIntervalMonths` (number): Default `3` (Configurable 1–12)
- `policyVersion` (number): Incremented on each update
- `updatedAt` (ISO timestamp)
- `updatedBy` (string): Administrator UID
- `updatedByEmail` (string)

### `systemSettings/siteConfiguration`
- `siteName` (string)
- `contactEmail` (string)
- `contactPhone` (string)
- `emergencyHelplineNotice` (string)
- `publicSearchEnabled` (boolean)

### `auditLogs/{logId}` (Immutable)
- `actorUid` (string): Initiator UID
- `actorEmail` (string)
- `action` (string): e.g. `'donor.approve'`, `'policy.update_interval'`, `'user.update_roles'`
- `entityType` (string): `'donor' | 'policy' | 'user' | 'role' | 'import' | 'settings'`
- `entityId` (string)
- `previousValues` (object, sanitized)
- `newValues` (object, sanitized)
- `timestamp` (ISO timestamp)
- `outcome` (string): `'success' | 'failure'`
- `reason` (string, optional)

---

## 4. Availability Policy Engine

### Algorithm
```typescript
eligibilityDate = addCalendarMonths(lastDonationDate, minimumIntervalMonths);
```
- **Calendar-Month Arithmetic:** Months are added to the year/month components, and days are clamped to the target month's maximum length (e.g. `2026-01-31` + 3 months $\rightarrow$ `2026-04-30`).
- **Leap-Year Preservation:** `2023-11-30` + 3 months $\rightarrow$ `2024-02-29`.
- **Public Visibility Gate:** A donor appears in public searches if and only if:
  1. `approvalStatus === 'approved'`
  2. `contactVerificationStatus === 'verified'`
  3. `accountStatus === 'active'`
  4. `declaredAvailability !== 'unavailable'`
  5. A valid recorded `lastDonationDate` exists
  6. Current Bangladesh Standard Time date $\ge$ `eligibilityDate`

---

## 5. Security & Privacy Protections

1. **Least-Privilege ABAC:**
   - Unauthenticated visitors can ONLY query approved, verified, active donors with public consent.
   - Donors can update their availability toggle and profile, but cannot self-approve or self-verify.
   - Only authorized administrators with `settings.availability_policy.manage` can modify the waiting interval.
2. **Immutable Audit Logs:** Audit logs can be created by authorized actors but cannot be updated or deleted.
3. **Super Admin Lockout Prevention:** The last remaining active Super Admin cannot remove their own Super Admin privileges.
4. **Spreadsheet Formula Injection Safeguard:** All exported or imported text starting with `=`, `+`, `-`, `@`, `\t`, or `\r` is escaped with `'` to prevent command execution in Microsoft Excel or Google Sheets.
5. **No Exposure of Secrets:** Firebase Admin SDK service account keys and private SMS API credentials are never bundled in client code.

---

## 6. Local Setup & Testing

### Prerequisites
- Node.js 20+
- npm

### Installation
```bash
npm install
```

### Running Automated Test Suite
```bash
npm test
```

### Compiling Production Build
```bash
npm run build
```

### Running Local Development Server
```bash
npm run dev
```

---

## 7. Firebase Setup & Deployment

1. **Authentication:**
   - Go to Firebase Console $\rightarrow$ Authentication $\rightarrow$ Sign-in method.
   - Enable **Email/Password** and **Google**.
2. **Firestore Security Rules:**
   - Deploy `firestore.rules` using Firebase CLI:
     ```bash
     firebase deploy --only firestore:rules
     ```
3. **Bootstrapped Administrator:**
   - Log in with `abrar.noceng@gmail.com` to receive automatic Super Admin access.
