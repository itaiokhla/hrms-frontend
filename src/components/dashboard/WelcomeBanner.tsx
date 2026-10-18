interface Props {
  username?: string;
}

export default function WelcomeBanner({ username }: Props) {
  return (
    <div className="mb-8 rounded-3xl bg-gradient-to-r from-blue-600 to-indigo-700 p-8 text-white shadow-xl">
      <h1 className="text-4xl font-bold">
        Welcome Back, {username || "Admin"} 👋
      </h1>

      <p className="mt-2 text-blue-100">
        Facial Attendance & Salary Management Dashboard
      </p>

      <p className="mt-4 text-sm text-blue-200">
        {new Date().toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </p>
    </div>
  );
}