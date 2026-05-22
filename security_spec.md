# Firebase Security Spec

## 1. Data Invariants
- A transaction MUST belong to a valid signed-in user (`userId == request.auth.uid`).
- Non-owners cannot read, list, update, or delete transaction data.
- The amount MUST be a positive number (> 0).
- The type MUST strictly be either 'income' or 'expense'.
- Timestamps (`createdAt`, `updatedAt`) MUST be strictly controlled by the server (`request.time`).
- Optional `description` field cannot exceed 200 characters to prevent buffer overflow/exhaustion.

## 2. The Great Twelve Malicious Payloads
1. **Identity Spoofing**: Attempt to create a transaction with a `userId` belonging to another user.
2. **Missing Author**: Attempt to create a transaction without any `userId` key.
3. **Double Entry Type Spoof**: A type value of 'both' or an empty string.
4. **Negative Expense**: An amount of `-100000` to steal money or cheat calculation.
5. **Zero Amount**: An amount of `0`.
6. **Huge ID**: A transaction ID with 500 characters to poison the database.
7. **Temporal Fraud (Create)**: Overwriting `createdAt` with a client-side date instead of `request.time`.
8. **Temporal Fraud (Update)**: Modifying `createdAt` during editing.
9. **SQL/HTML Injection in Description**: Including a 50,000 character string or code tags in description.
10. **Ghost Fields Update**: Attempting to inject `isAdmin: true` into a transaction.
11. **Malicious ID**: Inserting weird special characters into the Document ID (`../../bad/path`).
12. **Bypassing Query Filter**: Trying to perform a blanket read query on all transactions without a filter.
