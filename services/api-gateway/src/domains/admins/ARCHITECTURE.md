# Admin Authentication Architecture

Gateway owns the public browser boundary. It validates request shapes, rejects a present browser origin unless it exactly matches the configured admin client, applies route-specific IP and protected-email abuse controls, and gives every Identity gRPC call a bounded deadline.

Gateway contains no admin eligibility or activation business rules. Identity decides whether a provisioned account may receive an OTP, verifies the OTP, hashes the submitted password, and performs the activation transition. Activation creates no browser credential; login is the only route that receives an admin session token.

Admin login has independent client-IP and protected-email abuse controls. Gateway forwards the validated command with a bounded Identity deadline and places the opaque Identity-issued token only in `eventa_admin_session`; the response body contains no session credential.

Gateway authenticates the admin cookie through Identity before requesting account data. Identity returns only bounded session identity from Redis; a separate account query supplies the activated admin ID and email. Logout asks Identity to revoke the session before Gateway clears the cookie, so dependency failure cannot look like a successful sign-out.

Admin password recovery keeps its own browser routes, abuse-control namespace, and bounded Identity calls. Gateway never sees stored password hashes or owns reset eligibility, temporary state, session invalidation, or email delivery.
