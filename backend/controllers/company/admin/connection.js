const {
  Connection,
  normalizeConnectionsBody,
  sanitizeConnection,
} = require("#utils/connection");

async function getConnection(req, res, next) {
  try {
    const doc = await Connection.findOne({ companyId: req.companyId });

    return res.status(200).json({
      success: true,
      connection: sanitizeConnection(doc),
    });
  } catch (error) {
    return next(error);
  }
}

async function createConnection(req, res, next) {
  try {
    const filter = { companyId: req.companyId };
    const payload = normalizeConnectionsBody(req.body);

    if (!payload.connections.length) {
      return res.status(400).json({
        success: false,
        message: "Connections are required.",
      });
    }

    const existing = await Connection.findOne(filter);

    const doc = await Connection.findOneAndUpdate(
      filter,
      {
        $set: {
          companyId: req.companyId,
          connections: payload.connections,
        },
      },
      {
        returnDocument: "after",
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(existing ? 200 : 201).json({
      success: true,
      message: existing ? "Connection replaced." : "Connection created.",
      connection: sanitizeConnection(doc),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createConnection,
  getConnection,
};
