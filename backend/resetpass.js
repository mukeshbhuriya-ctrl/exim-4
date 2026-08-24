require("dotenv").config({ quiet: true });

const {
  connectDatabase,
  normalizeEmail,
} = require("#utils/siteadmin");
const { User } = require("#utils/user");
const { hashCompanyUserPassword } = require("#utils/companyUserPassword");

const MIN_LENGTH = 8;

async function main() {
  const emailArg = process.argv[2];
  const newPassword = process.argv[3];

  if (!emailArg || newPassword === undefined || newPassword === "") {
    console.error(
      "Usage: node resetpass.js <email> <newPassword>\n" +
        "Updates company user (`user` collection) where email matches."
    );
    process.exit(1);
  }

  if (String(newPassword).length < MIN_LENGTH) {
    console.error(`New password must be at least ${MIN_LENGTH} characters.`);
    process.exit(1);
  }

  const email = normalizeEmail(emailArg);

  await connectDatabase();

  const passwordHash = hashCompanyUserPassword(newPassword);

  const user = await User.findOneAndUpdate(
    { email },
    {
      $set: {
        passwordHash,
        defaultPassword: false,
      },
    },
    { returnDocument: "after" }
  );

  if (!user) {
    console.error(`No company user found with email: ${email}`);
    process.exit(1);
  }

  console.log(`Password updated for: ${user.email}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
