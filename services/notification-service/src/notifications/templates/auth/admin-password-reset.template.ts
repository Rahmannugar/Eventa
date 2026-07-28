export function adminPasswordResetTemplate(code: string): {
  html: string;
  subject: string;
  text: string;
} {
  return {
    html: [
      '<p>Use this one-time code to reset your Eventa admin password:</p>',
      `<p><strong>${code}</strong></p>`,
      '<p>This code expires in 15 minutes. If you did not request a password reset, you can ignore this email.</p>',
    ].join(''),
    subject: 'Reset your Eventa admin password',
    text: `Use ${code} to reset your Eventa admin password. This code expires in 15 minutes. If you did not request a password reset, you can ignore this email.`,
  };
}
