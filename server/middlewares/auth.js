import jwt from "jsonwebtoken";

// middleware to check for authenticated user
export const auth = (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res.status(403).json({ message: "Please Authenticate" });
    }

    const decoded = jwt.verify(
      token,
      process.env.EXPO_PUBLIC_ACCESS_TOKEN_SECRET
    );
    req.user = decoded;
    next();
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Please Authenticate" });
  }
};
