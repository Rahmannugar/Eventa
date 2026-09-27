package auth

// The four auth emails. Wording, subject and HTML match the TypeScript
// templates byte for byte so recipients see no change across the port.

// AttendeeEmailVerificationTemplate renders the attendee email verification code.
func AttendeeEmailVerificationTemplate(secret string) Content {
	return Content{
		Subject: "Verify your Eventa email",
		HTML: "<p>Use this one-time code to verify your Eventa email address:</p>" +
			"<p><strong>" + secret + "</strong></p>" +
			"<p>This code expires in 15 minutes. If you did not create an Eventa account, you can ignore this email.</p>",
		Text: "Use " + secret + " to verify your Eventa email address. " +
			"This code expires in 15 minutes. If you did not create an Eventa account, you can ignore this email.",
	}
}

// AttendeePasswordResetTemplate renders the attendee password reset code.
func AttendeePasswordResetTemplate(secret string) Content {
	return Content{
		Subject: "Reset your Eventa password",
		HTML: "<p>Use this one-time code to reset your Eventa password:</p>" +
			"<p><strong>" + secret + "</strong></p>" +
			"<p>This code expires in 15 minutes. If you did not request a password reset, you can ignore this email.</p>",
		Text: "Use " + secret + " to reset your Eventa password. " +
			"This code expires in 15 minutes. If you did not request a password reset, you can ignore this email.",
	}
}

// AdminActivationTemplate renders the admin activation code.
func AdminActivationTemplate(secret string) Content {
	return Content{
		Subject: "Activate your Eventa admin account",
		HTML: "<p>Use this one-time code to activate your Eventa admin account:</p>" +
			"<p><strong>" + secret + "</strong></p>" +
			"<p>This code expires in 15 minutes. If you were not expecting this email, you can ignore it.</p>",
		Text: "Use " + secret + " to activate your Eventa admin account. " +
			"This code expires in 15 minutes. If you were not expecting this email, you can ignore it.",
	}
}

// AdminPasswordResetTemplate renders the admin password reset code.
func AdminPasswordResetTemplate(secret string) Content {
	return Content{
		Subject: "Reset your Eventa admin password",
		HTML: "<p>Use this one-time code to reset your Eventa admin password:</p>" +
			"<p><strong>" + secret + "</strong></p>" +
			"<p>This code expires in 15 minutes. If you did not request a password reset, you can ignore this email.</p>",
		Text: "Use " + secret + " to reset your Eventa admin password. " +
			"This code expires in 15 minutes. If you did not request a password reset, you can ignore this email.",
	}
}
