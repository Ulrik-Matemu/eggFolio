const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs'); // For password hashing
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// MySQL connection
const db = mysql.createConnection({
    host: 'localhost',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'egg_sales'
});

db.connect((err) => {
    if (err) throw err;
    console.log("MySQL EggsTypeShit Connected...");
});

// User Registration
app.post('/api/register', (req, res) => {
    const { username, password, role } = req.body;
    const hashedPassword = bcrypt.hashSync(password, 10); // Hash the password
    const sql = 'INSERT INTO users (username, password, role) VALUES (?, ?, ?)';
    db.query(sql, [username, hashedPassword, role], (err, result) => {
        if (err) return res.status(500).json({ message: 'Error registering user', error: err });
        res.status(201).json({ message: 'User registered successfully' });
    });
});

// User Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const sql = 'SELECT * FROM users WHERE username = ?';
    db.query(sql, [username], (err, results) => {
        if (err || results.length === 0) return res.status(401).json({ message: 'Invalid username or password' });

        const user = results[0];
        if (bcrypt.compareSync(password, user.password)) {
            const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
            res.json({ message: 'Login successful', user, token });
        } else {
            res.status(401).json({ message: 'Invalid username or password' });
        }
    });
});

// Get all egg batches
app.get('/api/eggs', (req, res) => {
    db.query('SELECT * FROM eggs', (err, results) => {
        if (err) throw err;
        res.send(results);
    });
});

// Add new egg batch
app.post('/api/eggs', (req, res) => {
    const { batch_name, trays, buying_price } = req.body;
    const quantity = trays * 30;
    const sql = `INSERT INTO eggs (batch_name, quantity, trays, buying_price) VALUES (?, ?, ?, ?)`;
    db.query(sql, [batch_name, quantity, trays, buying_price], (err, result) => {
        if (err) throw err;
        res.send({ id: result.insertId });
    });
});

// Delete an egg batch
app.delete('/api/eggs/:id', (req, res) => {
    const id = req.params.id;
    const deleteBatchSQL = `DELETE FROM eggs WHERE id = ?`;
    db.query(deleteBatchSQL, [id], (err, result) => {
        if (err) throw err;
        res.send({ success: true, message: "Batch deleted successfully" });
    });
});

// Get all sales with related egg batch_name from sales table
app.get('/api/sales', (req, res) => {
    const getSalesSQL = `
        SELECT sales.id, sales.quantity_sold, sales.sale_price, eggs.batch_name, sales.created_at
        FROM sales
        JOIN eggs ON sales.batch_id = eggs.id`;
    
    db.query(getSalesSQL, (err, saleResult) => {
        if (err) {
            console.error("Error fetching sales data:", err);
            return res.status(500).send({ success: false, message: 'Database error', error: err });
        }
        res.send(saleResult);
    });
});

// Record sale and deduct eggs from batch
app.post('/api/sales', (req, res) => {
    const { batch_id, quantity_sold, sale_price } = req.body; // Fixed typo here
    console.log("Batch Id received from client:", batch_id);

    // Check if the batch exists and has enough quantity
    const checkBatchSQL = `SELECT quantity, batch_name FROM eggs WHERE id = ?`;
    db.query(checkBatchSQL, [batch_id], (err, batchResults) => {
        if (err) {
            console.error("Error querying the database:", err);
            return res.status(500).send({ success: false, message: 'Database error' });
        }

        if (batchResults.length > 0) {
            const availableQuantity = batchResults[0].quantity;
            const batch_name = batchResults[0].batch_name;

            // Check if there is enough quantity in stock
            if (availableQuantity >= quantity_sold) {
                // Insert the sale
                const insertSaleSQL = `
                    INSERT INTO sales (batch_id, quantity_sold, sale_price, batch_name) 
                    VALUES (?, ?, ?, ?)`;
                db.query(insertSaleSQL, [batch_id, quantity_sold, sale_price, batch_name], (err, saleResult) => {
                    if (err) {
                        console.error("Error inserting sale:", err);
                        return res.status(500).send({ success: false, message: 'Database error' });
                    }

                    // Deduct the sold quantity from the batch
                    const updateEggsSQL = `UPDATE eggs SET quantity = quantity - ? WHERE id = ?`;
                    db.query(updateEggsSQL, [quantity_sold, batch_id], (err, updateResult) => {
                        if (err) {
                            console.error("Error updating egg quantity:", err);
                            return res.status(500).send({ success: false, message: 'Database error' });
                        }

                        // Return success response
                        res.send({ success: true, message: 'Sale recorded and eggs deducted' });
                    });
                });
            } else {
                console.log(availableQuantity + " " + quantity_sold);
                res.status(400).send({ success: false, message: 'Not enough eggs in stock' });
            }
        } else {
            console.log("No batch found with the given batch_id");
            res.status(404).send({ success: false, message: 'Batch not found' });
        }
    });
});

// Delete a sale by ID and update egg batch quantity
app.delete('/api/sales/:id', (req, res) => {
    const saleId = req.params.id;

    // First, fetch the sale to get the batch ID and quantity sold
    const getSaleSQL = `SELECT batch_id, quantity_sold FROM sales WHERE id = ?`;
    db.query(getSaleSQL, [saleId], (err, saleResult) => {
        if (err) {
            console.error("Error fetching sale:", err);
            return res.status(500).send({ success: false, message: 'Database error', error: err });
        }

        if (saleResult.length > 0) {
            const { batch_id, quantity_sold } = saleResult[0];

            // Proceed to delete the sale
            const deleteSaleSQL = `DELETE FROM sales WHERE id = ?`;
            db.query(deleteSaleSQL, [saleId], (err, deleteResult) => {
                if (err) {
                    console.error("Error deleting sale:", err);
                    return res.status(500).send({ success: false, message: 'Database error', error: err });
                }

                if (deleteResult.affectedRows === 0) {
                    return res.status(404).send({ success: false, message: 'Sale not found' });
                }

                // Add back the quantity to the egg batch
                const updateEggsSQL = `UPDATE eggs SET quantity = quantity + ? WHERE id = ?`;
                db.query(updateEggsSQL, [quantity_sold, batch_id], (err, updateResult) => {
                    if (err) {
                        console.error("Error updating egg quantity:", err);
                        return res.status(500).send({ success: false, message: 'Database error', error: err });
                    }

                    // Return success response
                    res.send({ success: true, message: 'Sale deleted and egg quantity updated' });
                });
            });
        } else {
            return res.status(404).send({ success: false, message: 'Sale not found' });
        }
    });
});

// Sync route
app.post('/api/sync', (req, res) => {
    const { batches, sales } = req.body;

    // Sync batches
    batches.forEach(batch => {
        const sql = `INSERT INTO eggs (batch_name, quantity, trays, buying_price) 
                     VALUES (?, ?, ?, ?) 
                     ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), trays = VALUES(trays), buying_price = VALUES(buying_price)`;
        db.query(sql, [batch.batch_name, batch.quantity, batch.trays, batch.buying_price], (err, result) => {
            if (err) console.error("Error syncing batch:", err);
        });
    });

    // Sync sales
    sales.forEach(sale => {
        const sql = `INSERT INTO sales (batch_id, quantity_sold, sale_price) 
                     VALUES (?, ?, ?) 
                     ON DUPLICATE KEY UPDATE quantity_sold = VALUES(quantity_sold), sale_price = VALUES(sale_price)`;
        db.query(sql, [sale.batch_id, sale.quantity_sold, sale.sale_price], (err, result) => {
            if (err) console.error("Error syncing sale:", err);
        });
    });

    res.send({ success: true, message: "Data synced successfully" });
});


// Initialize Egg Sales Manager
const PORT = 5000;
app.listen(PORT, () => console.log(`Egg Sales Manager running on port ${PORT}`));
