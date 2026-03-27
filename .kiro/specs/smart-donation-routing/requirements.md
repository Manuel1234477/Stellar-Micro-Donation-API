# Requirements Document

## Introduction

Smart donation routing automatically selects the best recipient for a donation when the donor does not specify one. The system supports four configurable strategies: highest-need (favors recipients with the lowest recent donation totals), geographic proximity (favors recipients nearest to the donor), campaign-urgency (favors recipients whose campaigns are closest to their deadline), and round-robin (distributes donations evenly across the pool). Every routing decision is deterministic and produces an audit trail so that selections can be reviewed and reproduced.

## Glossary

- **DonationRouter**: The service responsible for selecting a recipient from a pool using a configured strategy.
- **Recipient**: An entity (individual, organization, or campaign) that can receive a donation.
- **Recipient_Pool**: A named, admin-managed collection of Recipients available for routing.
- **Routing_Strategy**: The algorithm used to select a Recipient from a Recipient_Pool.
- **Routing_Decision**: The immutable record produced by the DonationRouter that captures the selected Recipient, the strategy used, the pool state at decision time, and a timestamp.
- **Admin_API**: The privileged HTTP API used to manage Recipient_Pools.
- **Donation_Request**: The payload submitted by a donor to initiate a donation.
- **Round_Robin_State**: The persistent counter that tracks the next Recipient index for a given Recipient_Pool under the round-robin strategy.

## Requirements

### Requirement 1: Routing Strategy Selection

**User Story:** As a donor, I want to specify a routing strategy when making a donation without a specific recipient, so that my donation is directed according to my preferred criteria.

#### Acceptance Criteria

1. WHEN a Donation_Request includes a `routingStrategy` field and no explicit recipient, THE DonationRouter SHALL select a Recipient from the designated Recipient_Pool using the specified Routing_Strategy.
2. WHEN a Donation_Request omits the `routingStrategy` field and no explicit recipient is provided, THE DonationRouter SHALL reject the request with a descriptive error indicating that either a recipient or a routing strategy is required.
3. WHEN a Donation_Request specifies an unrecognized `routingStrategy` value, THE DonationRouter SHALL reject the request with a descriptive error listing the supported strategy names.
4. THE DonationRouter SHALL support exactly the following strategy names: `highest-need`, `geographic`, `campaign-urgency`, and `round-robin`.

---

### Requirement 2: Highest-Need Strategy

**User Story:** As a donor, I want my donation routed to the recipient with the lowest recent donation total, so that underserved recipients receive priority.

#### Acceptance Criteria

1. WHEN the `highest-need` strategy is selected, THE DonationRouter SHALL calculate the total donations received by each Recipient in the pool within the configured lookback window.
2. WHEN the `highest-need` strategy is selected, THE DonationRouter SHALL select the Recipient with the lowest calculated total.
3. WHEN two or more Recipients share the lowest total under the `highest-need` strategy, THE DonationRouter SHALL select the Recipient with the lowest lexicographic identifier among the tied candidates, ensuring a deterministic result.

---

### Requirement 3: Geographic Proximity Strategy

**User Story:** As a donor, I want my donation routed to the nearest recipient, so that I can support causes in my local area.

#### Acceptance Criteria

1. WHEN the `geographic` strategy is selected and the Donation_Request includes donor coordinates, THE DonationRouter SHALL calculate the distance between the donor's coordinates and each Recipient's registered coordinates using the Haversine formula.
2. WHEN the `geographic` strategy is selected, THE DonationRouter SHALL select the Recipient with the smallest calculated distance.
3. WHEN two or more Recipients share the smallest distance under the `geographic` strategy, THE DonationRouter SHALL select the Recipient with the lowest lexicographic identifier among the tied candidates.
4. IF the `geographic` strategy is selected and the Donation_Request does not include donor coordinates, THEN THE DonationRouter SHALL reject the request with a descriptive error indicating that donor coordinates are required for geographic routing.
5. IF a Recipient in the pool does not have registered coordinates, THEN THE DonationRouter SHALL exclude that Recipient from geographic selection and include the exclusion in the Routing_Decision audit record.

---

### Requirement 4: Campaign-Urgency Strategy

**User Story:** As a donor, I want my donation routed to the campaign closest to its deadline, so that time-sensitive campaigns receive support before they expire.

#### Acceptance Criteria

1. WHEN the `campaign-urgency` strategy is selected, THE DonationRouter SHALL evaluate each Recipient's campaign deadline relative to the current timestamp.
2. WHEN the `campaign-urgency` strategy is selected, THE DonationRouter SHALL select the Recipient whose campaign deadline is nearest to but not before the current timestamp.
3. WHEN two or more Recipients share the nearest deadline under the `campaign-urgency` strategy, THE DonationRouter SHALL select the Recipient with the lowest lexicographic identifier among the tied candidates.
4. IF all Recipients in the pool have campaign deadlines that have already passed, THEN THE DonationRouter SHALL reject the request with a descriptive error indicating that no active campaigns are available.
5. IF a Recipient in the pool does not have a campaign deadline, THEN THE DonationRouter SHALL exclude that Recipient from campaign-urgency selection and include the exclusion in the Routing_Decision audit record.

---

### Requirement 5: Round-Robin Strategy

**User Story:** As a platform operator, I want donations distributed evenly across all recipients in a pool, so that no single recipient is disproportionately favored.

#### Acceptance Criteria

1. WHEN the `round-robin` strategy is selected, THE DonationRouter SHALL select the Recipient at the current Round_Robin_State index for the designated Recipient_Pool.
2. AFTER a Recipient is selected via round-robin, THE DonationRouter SHALL increment the Round_Robin_State index for that pool, wrapping to zero when the index exceeds the last position in the pool.
3. THE DonationRouter SHALL persist the Round_Robin_State so that the sequence is maintained across service restarts.
4. WHEN a Recipient is added to or removed from a Recipient_Pool, THE DonationRouter SHALL reset the Round_Robin_State for that pool to zero.

---

### Requirement 6: Recipient Pool Management

**User Story:** As a platform administrator, I want to manage recipient pools via an API, so that I can control which recipients are eligible for automatic routing.

#### Acceptance Criteria

1. THE Admin_API SHALL provide an endpoint to create a named Recipient_Pool containing an initial list of Recipient identifiers.
2. THE Admin_API SHALL provide an endpoint to retrieve the current members of a named Recipient_Pool.
3. THE Admin_API SHALL provide an endpoint to add one or more Recipients to an existing Recipient_Pool.
4. THE Admin_API SHALL provide an endpoint to remove one or more Recipients from an existing Recipient_Pool.
5. THE Admin_API SHALL provide an endpoint to delete a Recipient_Pool.
6. IF a request is made to create a Recipient_Pool with a name that already exists, THEN THE Admin_API SHALL reject the request with a descriptive conflict error.
7. IF a request references a Recipient_Pool name that does not exist, THEN THE Admin_API SHALL return a descriptive not-found error.
8. IF a request attempts to remove a Recipient that is not a member of the specified Recipient_Pool, THEN THE Admin_API SHALL return a descriptive error.
9. WHILE a Recipient_Pool contains zero members, THE DonationRouter SHALL reject any routing request targeting that pool with a descriptive error indicating the pool is empty.

---

### Requirement 7: Routing Decision Audit Trail

**User Story:** As a platform operator, I want every routing decision recorded with full context, so that selections can be audited and reproduced.

#### Acceptance Criteria

1. WHEN the DonationRouter selects a Recipient, THE DonationRouter SHALL create a Routing_Decision record containing: the selected Recipient identifier, the Routing_Strategy name, the Recipient_Pool name, the ordered list of candidate Recipients considered, the timestamp of the decision, and the donation identifier.
2. THE DonationRouter SHALL store each Routing_Decision record in durable storage immediately after selection and before the donation is confirmed.
3. THE Admin_API SHALL provide an endpoint to retrieve Routing_Decision records filtered by donation identifier, Recipient_Pool name, or Routing_Strategy name.
4. THE Routing_Decision record SHALL be immutable after creation.

---

### Requirement 8: Donation Response Includes Selected Recipient

**User Story:** As a donor, I want the donation response to include the selected recipient, so that I know where my donation was directed.

#### Acceptance Criteria

1. WHEN a donation is successfully routed, THE DonationRouter SHALL include the selected Recipient's identifier and display name in the donation response payload.
2. WHEN a donation is successfully routed, THE DonationRouter SHALL include the Routing_Decision identifier in the donation response payload so the donor can reference the audit record.
