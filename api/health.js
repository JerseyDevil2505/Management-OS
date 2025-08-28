export default async function handler(req, res) {
  res.status(200).json({
    status: "Backend is working!",
    timestamp: new Date().toISOString()
  });
}
