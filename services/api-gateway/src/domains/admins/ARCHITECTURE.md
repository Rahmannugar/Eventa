# Admin Authentication Architecture

Gateway owns the public browser boundary. It validates request shapes, requires the exact admin-client origin, applies route-specific IP and protected-email abuse controls, and gives every Identity gRPC call a bounded deadline.

The activation credential is an opaque 32-byte value carried only in a host-only HttpOnly cookie. Gateway never exposes it in a response body. The cookie is `SameSite=Lax`, secure on HTTPS, scoped to the activation routes, and cleared after successful password setup.

Gateway contains no admin eligibility or activation business rules. Identity decides whether a provisioned account may receive an OTP, verifies temporary state, and performs the activation transition.
