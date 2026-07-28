export function attendeeEmailVerificationTemplate(otp: string): {
  html: string;
  subject: string;
  text: string;
} {
  return {
    html: [
      '<p>Use this one-time code to verify your Eventa email address:</p>',
      `<p><strong>${otp}</strong></p>`,
      '<p>This code expires in 15 minutes. If you did not create an Eventa account, you can ignore this email.</p>',
    ].join(''),
    subject: 'Verify your Eventa email',
    text: `Use ${otp} to verify your Eventa email address. This code expires in 15 minutes. If you did not create an Eventa account, you can ignore this email.`,
  };
}
