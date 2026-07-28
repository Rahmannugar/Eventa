export function adminActivationTemplate(otp: string): {
  html: string;
  subject: string;
  text: string;
} {
  return {
    html: [
      '<p>Use this one-time code to activate your Eventa admin account:</p>',
      `<p><strong>${otp}</strong></p>`,
      '<p>This code expires in 15 minutes. If you were not expecting this email, you can ignore it.</p>',
    ].join(''),
    subject: 'Activate your Eventa admin account',
    text: `Use ${otp} to activate your Eventa admin account. This code expires in 15 minutes. If you were not expecting this email, you can ignore it.`,
  };
}
