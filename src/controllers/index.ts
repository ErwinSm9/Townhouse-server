import pool from "../pg"
import { createTransport } from "nodemailer"
import {genSalt, compare, hash} from "bcryptjs"
import { verify, sign } from "jsonwebtoken"
import axios from "axios"


function createVerificationCode(){
    let date=new Date()
    let min=date.getMinutes()<10?`0${date.getMinutes()}`:date.getMinutes()
    let code=`${min}${date.getFullYear()}`
    return code
}

async function sendEmail(emailTo:any,subject:string,text:string){
    try{
        let transporter=createTransport({
            service:'gmail',
            auth:{
                user:process.env.TRANSPORTER_EMAIL,
                pass:process.env.EMAIL_PASSWORD
            }
        })

        const mailOptions = {
            from: `${process.env.TRANSPORTER_EMAIL}`,
            to: `${emailTo}`,
            subject: `${subject}`,
            text: `${text}`,
        };
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('Error sending email:', error);
            } else {
                console.log('Email sent:', info.response);
            }
        });
    }catch(error:any){
        console.log('Error sending email:', error)
    }
}

export async function verifyEmail(req:any,res:any){
    try{
        const {email}=req.body
        let code=createVerificationCode()

        pool.query('SELECT * FROM users WHERE email = $1',[email],(error,results)=>{
        if(!results.rows[0]){
            sendEmail(email,`Townhouse verification code`,`Your verification code ${code}`
)
        }else{
            res.send({error:`This account already exist!`})
        }
        })
    }catch(error:any){
        res.status(501).send({error:error.message})
    }
}

export async function createAccount(req:any,res:any){
    try{
        const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const {username, email, password, user_city, user_postal_code, user_lang, user_time_zone, user_browser, last_time_loggedin,phone_number}=req.body
        if (username&&email&&password&&phone_number) {
            const salt=await genSalt(10);
            const hashedPassword=await hash(password,salt);
            pool.query("SELECT * FROM users WHERE email=$1",[email],(error,results)=>{
                if(error){
                    console.log(error)
                }else{
                    console.log(results.rows, results.rows.length)
                    if(results.rows.length===0){
                        pool.query('INSERT INTO users (username, email, password, user_browser, provider, ip_address, user_city, user_postal_code,user_lang,phone_number) VALUES ($1, $2, $3, $4, $5, $6,$7,$8,$9,$10) RETURNING *', [username, email, hashedPassword, user_browser,'townhouse',clientIp,user_city,user_postal_code,user_lang,phone_number],(error, results) => {
                            if (error) {
                                let errorMessage=error.message===`duplicate key value violates unique constraint "users_username_key"`?`Try a different username, username ${username} is taken`:error.message
                                console.log(error.message)
                                res.status(408).send({error:errorMessage})
                            }else{
                                res.status(201).send({
                                    msg:`Welcome to Townhouse`,
                                    data:{
                                        username:results.rows[0].username,
                                        email:results.rows[0].email,
                                        email_verified:results.rows[0].email_verified,
                                        photo:results.rows[0].photo,
                                        phone_number:results.rows[0].phone_number,
                                        access_token:generateUserToken(results.rows[0].provider),
                                        location:`${results.rows[0].user_city}, ${results.rows[0].user_country}`
                                    }
                                })
                            }
                        })
                    }else{
                        res.status(408).send({error:`This account exists!, Try logging in`})
                    }
                }
            })       
        } else {
            res.status(403).send({error:"Fill all the required fields!!"})
        }
    }catch(error:any){
        res.status(501).send({error:error.message})
    }
}

export async function login(req:any,res:any){
    try{
        let code=createVerificationCode()
        const clientIp= req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const {email, password, last_time_loggedin, user_browser}=req.body
        if(email&&password&&last_time_loggedin){
            pool.query("SELECT * FROM users WHERE email = $1 AND provider='townhouse'",[email], async(error,results)=>{
                if(error){
                    console.log(error)
                    res.status(400).send({error:'Failed to sign in, try again!'})
                }else{
                    if(results.rows[0]){
                        if(results.rows[0].email&&await compare(password,results.rows[0].password)){
                            pool.query('UPDATE users SET user_browser= $1, ip_address=$2 WHERE email = $3 RETURNING *',[user_browser, clientIp,results.rows[0].email],(error,results)=>{
                                if(error){
                                    console.log(error)
                                }else{
                                    res.status(201).send({
                                        verification_code:code,
                                        msg:`Sign in successfully`,
                                        data:{
                                            username:results.rows[0].username,
                                            email_verified:results.rows[0].email_verified,
                                            photo:results.rows[0].photo,
                                            phone_number:results.rows[0].phone_number,
                                            email:results.rows[0].email,
                                            location:`${results.rows[0].user_city}, ${results.rows[0].user_country}`,
                                            access_token:generateUserToken(results.rows[0].provider)
                                        }
                                    })
                                    sendEmail(email,`Townhouse Account Verification`,`Greeting, ${results.rows[0].username},\nYour verification code is \n${code}`)
                                }
                            })
                        }else if(await compare(password,results.rows[0].password)===false){
                            res.status(401).send({error:'You have enter the wrong password'})
                        } 
                    }else{
                        res.status(404).send({error:`This account does not exist!`})
                    }
                }
            })
        }else{
            res.status(403).send({error:"Fill all the required fields!!"})
        }
    }catch(error:any){
        res.status(501).send({error:error.message})
    }
}

export async function getUsers(req:any,res:any){
    try {
        pool.query('SELECT * FROM users', (error, results) => {
            if (error) {
                console.log(error)
                res.status(404).send({error:`Failed to get users.`})
            }else{
                res.status(200).json(results.rows)
            }
        })
    } catch (error:any) {
        res.status(500).send({error:error.message})
    }
}

export async function addEvent(req:any,res:any){
    try{
        const {id,host,creator_email,title,sub_title, description,event_tags,event_photo, date, starting_time,event_location,privacy}=req.body
        pool.query('INSERT INTO events (id,host,creator_email,title,sub_title, description,event_tags,event_photo,date, starting_time,event_location,privacy) VALUES ($1, $2, $3, $4, $5, $6,$7,$8,$9,$10,$11,$12) RETURNING *',[id,host,creator_email,title,sub_title, description,event_tags,event_photo, date, starting_time,event_location,privacy],(error,results)=>{
            if(error){
                console.log(error)
                res.status(201).send({error:"Failed to post event"})
            }else{
                let data={
                    id:results.rows[0].id,
                    image:results.rows[0].event_photo,
                    title:results.rows[0].title,
                    description:results.rows[0].description,
                    subTitle:results.rows[0].sub_title,
                    host:results.rows[0].host,
                    date:results.rows[0].date,
                    startingTime:results.rows[0].starting_time,
                    eventLocation:results.rows[0].event_location,
                    attendees:results.rows[0].attendees,
                    likes:results.rows[0].likes,
                    creatorEmail:results.rows[0].creator_email,
                    eventTags:results.rows[0].event_tags,
                    comments:results.rows[0].comments,
                    privacy:results.rows[0].privacy
                }
                res.status(200).send({
                    data
                })
            }
        })
    } catch (error:any) {
        res.status(500).send({error:error.message})
    }

}

export async function getEvents(req:any,res:any){
    try{
        pool.query('SELECT * FROM events WHERE privacy=false', (error, results) => {
            if (error) {
                console.log(error)
                res.status(404).send({error:`Failed to get events.`})
            }else{
                res.status(200).json({data:results.rows})
            }
        })

    } catch (error:any) {
        res.status(500).send({error:error.message})
    }

}

export async function deleteEvent(req:any,res:any){
    try{
        const {id,creator_email}=req.params
        pool.query('DELETE FROM events WHERE id=$1 AND creator_email=$2 RETURNING *',[id,creator_email], async(error, results) => {
            if (error) {
                console.log(error)
                res.status(404).send({error:`Failed to delete this event.`})
            }else{
                let response=await axios.delete(`${process.env.API_URL}/drive/delete/file/${results.rows[0].event_photo}`)
                let parseRes=await response.data
                console.log(parseRes)
                if(parseRes.id){
                    console.log(parseRes.id)
                }
                res.status(200).json({
                    msg:`Event deleted successfully`,
                })
            }
        })

    } catch (error:any) {
        res.status(500).send({error:error.message})
    }

}


export async function getEvent(req:any,res:any){
    try{
        const {id}=req.params
        pool.query('SELECT * FROM events WHERE id=$1 AND privacy=false',[id], (error, results) => {
            if (error) {
                console.log(error)
                res.status(404).send({error:`Failed to get this event.`})
            }else{
                let data={
                    id:results.rows[0].id,
                    image:results.rows[0].event_photo,
                    title:results.rows[0].title,
                    description:results.rows[0].description,
                    subTitle:results.rows[0].sub_title,
                    host:results.rows[0].host,
                    date:results.rows[0].date,
                    startingTime:results.rows[0].starting_time,
                    eventLocation:results.rows[0].event_location,
                    attendees:results.rows[0].attendees,
                    likes:results.rows[0].likes,
                    creatorEmail:results.rows[0].creator_email,
                    eventTags:results.rows[0].event_tags,
                    comments:results.rows[0].comments,
                    privacy:results.rows[0].privacy
                }
                res.status(200).send({
                    data
                })
            }
        })
    } catch (error:any) {
        res.status(500).send({error:error.message})
    }

}



export async function protectUser(req:any,res:any,next:any){
    let token
    if(req.headers.authorization&&req.headers.authorization.startsWith('Bearer')){
        try{
            token=req.headers.authorization.split(' ')[1]
            verify(token,`${process.env.JWT_SECRET}`)
            next()
        }catch(error:any){
            res.status(401).send({error:'Not Authorised'})
        }
    }
    if(!token){
        res.status(401).send({error:'No Token Available'})
    }
}

export async function getUserDetails(req:any,res:any){
    try {
        const { email } = req.params
        pool.query('SELECT * FROM users WHERE email = $1', [email], (error, results) => {
            if (error) {
                console.log(error)
                res.status(404).send({error:`Account associated with the email address ${email} does not exist!`})
            }else{
                if(results.rows[0]){
                    res.status(200).json({
                        data:{
                            username:results.rows[0].username,
                            email:results.rows[0].email,
                            email_verified:results.rows[0].email_verified,
                            phone_number:results.rows[0].phone_number,
                            photo:results.rows[0].photo,
                            location:`${results.rows[0].user_city}, ${results.rows[0].user_country}`,
                            access_token:generateUserToken(results.rows[0].provider)
                        }
                    })
                }else{
                    res.status(404).send({error:`Account associated with the email address ${email} does not exist!`})
                }
            }
        })
    } catch (error:any) {
        res.status(500).send({error:error.message})
    }
}

export async function authenticateUserWithAccessToken(req:any,res:any){
    try{
        let {access_token}=req.params
        pool.query("SELECT * FROM users WHERE access_token=$1 AND provider='google'",[access_token],(error,results)=>{
            if(error){
                console.log(error)
                res.status(501).send({error:error})
            }else{
                if(!results.rows[0]){
                    res.status(404).send({error:`Not Authorized!`})
                }else{
                    let data:any={
                        username:results.rows[0].username,
                        email:results.rows[0].email,
                        email_verified:results.rows[0].email_verified,
                        phone_number:results.rows[0].phone_number,
                        photo:results.rows[0].photo,
                        access_token:results.rows[0].access_token,
                        location:`${results.rows[0].user_city}, ${results.rows[0].user_country}`
                    }
                    res.status(400).send({
                        msg:`Authenticated successfully`,
                        data
                    })
                }
            }
        })
    } catch (error:any) {
        res.status(500).send({error:error.message})
    }
}

export function generateUserToken(id:string){
    return sign({id},`${process.env.JWT_SECRET}`,{
        expiresIn:'10d'
    })
}
