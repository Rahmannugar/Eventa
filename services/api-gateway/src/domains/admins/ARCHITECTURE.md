# Admin Authentication Architecture

Gateway owns the public browser boundary. It validates request shapes, requires the exact admin-client origin, applies route-specific IP and protected-email abuse controls, and gives every Identity gRPC call a bounded deadline.

The activation credential is an opaque 32-byte value carried only in a host-only HttpOnly cookie. Gateway never exposes it in a response body. The cookie is `SameSite=Lax`, secure on HTTPS, scoped to the activation routes, and cleared after successful password setup.

Gateway contains no admin eligibility or activation business rules. Identity decides whether a provisioned account may receive an OTP, verifies temporary state, and performs the activation transition.

Admin login has independent client-IP and protected-email abuse controls. Gateway forwards the validated command with a bounded Identity deadline and places the opaque Identity-issued token only in `eventa_admin_session`; the response body contains no session credential.

Gateway authenticates the admin cookie through Identity before requesting account data. Identity returns only bounded session identity from Redis; a separate account query supplies the activated admin ID and email. Logout asks Identity to revoke the session before Gateway clears the cookie, so dependency failure cannot look like a successful sign-out.

Admin password recovery keeps its own browser routes, abuse-control namespace, and bounded Identity calls. Gateway never sees stored password hashes or owns reset eligibility, temporary state, session invalidation, or email delivery.
